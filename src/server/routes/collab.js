/**
 * Collaboration aids: reusable blocks, watch list, and reader feedback.
 *
 *   GET    /api/blocks                 (signed in)
 *   POST   /api/blocks                 (editor) { id, name, body }
 *   PUT    /api/blocks/:id             (editor) { name, body }
 *   DELETE /api/blocks/:id             (editor)
 *
 *   GET    /api/watches                (signed in) -> { pages, activity }
 *   PUT    /api/watches/:pageId        (signed in)
 *   DELETE /api/watches/:pageId        (signed in)
 *
 *   POST   /api/feedback               (public) { pageId, message, contact?, website? }
 *   GET    /api/feedback?status=open|resolved|all   (editor)
 *   PATCH  /api/feedback/:id           (editor) { resolved }
 *   DELETE /api/feedback/:id           (editor)
 */

import { all, first, run } from '../db/index.js';
import { badRequest, conflict, notFound, readJson } from '../http.js';
import { audit } from '../audit.js';
import { enforceRateLimit } from '../ratelimit.js';
import { optionalString, requireString, clampLimit } from '../validate.js';
import { canEditPage } from '../auth/rbac.js';
import { getPage } from '../pages.js';
import { slugify } from '../../shared/page-id.js';

const SIGNED_IN = { auth: 'contributor' };
const EDITOR = { auth: 'editor' };

function presentBlock(row) {
    return {
        id: row.id, name: row.name, body: row.body,
        createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at
    };
}

function presentFeedback(row) {
    return {
        id: row.id, pageId: row.page_id, message: row.message, contact: row.contact,
        createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by
    };
}

export function register(router) {
    router.get('/api/blocks', async (ctx) => ({
        blocks: (await all(ctx.db, 'SELECT * FROM blocks ORDER BY name')).map(presentBlock)
    }), SIGNED_IN);

    router.post('/api/blocks', async (ctx) => {
        const body = await readJson(ctx.request);
        const name = requireString(body.name, 'Name', { max: 80 });
        const id = slugify(body.id || name);
        if (!id) throw badRequest('Block ID is required');
        const text = requireString(body.body, 'Body', { max: 20000, trim: false });
        if (await first(ctx.db, 'SELECT 1 FROM blocks WHERE id = ?', id)) throw conflict('A block with that ID already exists');
        const now = Date.now();
        await run(
            ctx.db,
            'INSERT INTO blocks (id, name, body, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id, name, text, ctx.user.username, now, ctx.user.username, now
        );
        await audit(ctx, 'block.create', `block:${id}`);
        return { block: presentBlock(await first(ctx.db, 'SELECT * FROM blocks WHERE id = ?', id)) };
    }, EDITOR);

    router.put('/api/blocks/:id', async (ctx) => {
        const existing = await first(ctx.db, 'SELECT * FROM blocks WHERE id = ?', ctx.params.id);
        if (!existing) throw notFound('Block not found');
        const body = await readJson(ctx.request);
        const name = body.name !== undefined ? requireString(body.name, 'Name', { max: 80 }) : existing.name;
        const text = body.body !== undefined ? requireString(body.body, 'Body', { max: 20000, trim: false }) : existing.body;
        await run(ctx.db, 'UPDATE blocks SET name = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?',
            name, text, ctx.user.username, Date.now(), existing.id);
        await audit(ctx, 'block.update', `block:${existing.id}`);
        return { block: presentBlock(await first(ctx.db, 'SELECT * FROM blocks WHERE id = ?', existing.id)) };
    }, EDITOR);

    router.delete('/api/blocks/:id', async (ctx) => {
        const result = await run(ctx.db, 'DELETE FROM blocks WHERE id = ?', ctx.params.id);
        if (!result.meta.changes) throw notFound('Block not found');
        await audit(ctx, 'block.delete', `block:${ctx.params.id}`);
        return { ok: true };
    }, EDITOR);

    router.get('/api/watches', async (ctx) => {
        const pages = await all(
            ctx.db,
            `SELECT w.page_id, w.created_at, p.title FROM watches w LEFT JOIN pages p ON p.id = w.page_id
             WHERE w.username = ? ORDER BY w.created_at DESC`,
            ctx.user.username
        );
        const activity = await all(
            ctx.db,
            `SELECT id, at, actor, action, target, details FROM audit
             WHERE target IN (SELECT 'page:' || page_id FROM watches WHERE username = ?)
               AND (actor IS NULL OR actor != ?)
             ORDER BY id DESC LIMIT ?`,
            ctx.user.username, ctx.user.username, clampLimit(ctx.query.get('limit'), 30, 100)
        );
        return {
            pages: pages.map((p) => ({ pageId: p.page_id, title: p.title, watchedAt: p.created_at })),
            activity: activity.map((a) => ({ ...a, pageId: a.target.slice(5), details: a.details ? JSON.parse(a.details) : null }))
        };
    }, SIGNED_IN);

    router.put('/api/watches/:pageId', async (ctx) => {
        const page = await getPage(ctx.db, ctx.params.pageId);
        if (!page || !canEditPage(ctx.user, page)) throw notFound('Page not found');
        await run(ctx.db, 'INSERT OR IGNORE INTO watches (username, page_id, created_at) VALUES (?, ?, ?)',
            ctx.user.username, page.id, Date.now());
        return { ok: true };
    }, SIGNED_IN);

    router.delete('/api/watches/:pageId', async (ctx) => {
        await run(ctx.db, 'DELETE FROM watches WHERE username = ? AND page_id = ?', ctx.user.username, ctx.params.pageId);
        return { ok: true };
    }, SIGNED_IN);

    router.post('/api/feedback', async (ctx) => {
        await enforceRateLimit(ctx, 'feedback');
        const body = await readJson(ctx.request, { maxBytes: 8192 });
        // Honeypot: real visitors never see or fill the "website" field.
        if (body.website) return { ok: true };
        const pageId = typeof body.pageId === 'string' ? body.pageId : '';
        const page = pageId ? await first(ctx.db, 'SELECT id FROM pages WHERE id = ? AND published IS NOT NULL', pageId) : null;
        if (!page) throw badRequest('Unknown page');
        const message = requireString(body.message, 'Message', { max: 2000 });
        const contact = optionalString(body.contact, 'Contact', { max: 200 });
        await run(ctx.db, 'INSERT INTO feedback (page_id, message, contact, created_at) VALUES (?, ?, ?, ?)',
            page.id, message, contact || null, Date.now());
        return { ok: true };
    });

    router.get('/api/feedback', async (ctx) => {
        const status = ctx.query.get('status') || 'open';
        const where = status === 'open' ? 'WHERE resolved_at IS NULL' : status === 'resolved' ? 'WHERE resolved_at IS NOT NULL' : '';
        const rows = await all(ctx.db, `SELECT * FROM feedback ${where} ORDER BY id DESC LIMIT 200`);
        return { feedback: rows.map(presentFeedback) };
    }, EDITOR);

    router.patch('/api/feedback/:id', async (ctx) => {
        const body = await readJson(ctx.request);
        if (typeof body.resolved !== 'boolean') throw badRequest('resolved must be true or false');
        const result = body.resolved
            ? await run(ctx.db, 'UPDATE feedback SET resolved_at = ?, resolved_by = ? WHERE id = ?', Date.now(), ctx.user.username, Number(ctx.params.id))
            : await run(ctx.db, 'UPDATE feedback SET resolved_at = NULL, resolved_by = NULL WHERE id = ?', Number(ctx.params.id));
        if (!result.meta.changes) throw notFound('Feedback not found');
        return { feedback: presentFeedback(await first(ctx.db, 'SELECT * FROM feedback WHERE id = ?', Number(ctx.params.id))) };
    }, EDITOR);

    router.delete('/api/feedback/:id', async (ctx) => {
        const result = await run(ctx.db, 'DELETE FROM feedback WHERE id = ?', Number(ctx.params.id));
        if (!result.meta.changes) throw notFound('Feedback not found');
        return { ok: true };
    }, EDITOR);
}
