/**
 * Pages, drafts, revisions and review workflow.
 *
 *   GET    /api/pages                          summaries (contributors see their own)
 *   POST   /api/pages                          { id, title, template? , schema? }
 *   GET    /api/pages/:id                      full draft + published snapshot info
 *   PUT    /api/pages/:id                      { baseVersion, title?, data?, schema? } save draft
 *   DELETE /api/pages/:id                      (editor) delete; unpublishes first if needed
 *   POST   /api/pages/:id/duplicate            { id, title }
 *   POST   /api/pages/:id/workflow             { action: submit | withdraw | reject, note? }
 *   GET    /api/pages/:id/revisions
 *   GET    /api/pages/:id/revisions/:rev
 *   POST   /api/pages/:id/revisions/:rev/restore   { baseVersion }
 *   GET    /api/templates
 *
 * Saves are optimistic: a stale baseVersion returns 409 instead of silently
 * overwriting someone else's edit.
 */

import { all, first, parseJson, run } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound, readJson } from '../http.js';
import { hasRole } from '../auth/rbac.js';
import { audit } from '../audit.js';
import { enforceRateLimit } from '../ratelimit.js';
import { optionalString } from '../validate.js';
import { emptyContent, validateContent, validateSchema } from '../../shared/schema.js';
import { isValidPageId } from '../../shared/page-id.js';
import { TEMPLATES } from '../../../templates/index.js';
import {
    getPage, listPages, presentPage, pruneRevisionsStatement, requireEditablePage,
    requireTitle, revisionStatement, saveRevisionStatements
} from '../pages.js';
import { hasDueSchedules, runScheduled, unpublishPages } from '../publish/publisher.js';

export const MAX_DRAFT_BYTES = 1024 * 1024;
const SIGNED_IN = { auth: 'contributor' };

export const BLANK_SCHEMA = {
    fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'body', label: 'Body', type: 'markdown', rows: 16 }
    ]
};

function requirePageId(value) {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!isValidPageId(id)) {
        throw badRequest('Page ID must be 1-64 characters of lowercase letters, numbers and single hyphens, and not a reserved word');
    }
    return id;
}

function requireValidSchema(input) {
    const { schema, errors } = validateSchema(input);
    if (errors.length) throw badRequest('Schema is invalid', errors);
    return schema;
}

function requireValidData(schema, data) {
    const result = validateContent(schema, data);
    if (result.errors.length) throw badRequest('Content is invalid', result.errors);
    const size = new TextEncoder().encode(JSON.stringify(result.data)).length;
    if (size > MAX_DRAFT_BYTES) throw badRequest('Content exceeds the 1MB page limit. Split it across pages or move images to media.');
    return result.data;
}

function requireBaseVersion(body, row) {
    if (!Number.isInteger(body.baseVersion)) throw badRequest('baseVersion is required');
    if (body.baseVersion !== row.version) {
        throw conflict('This page changed since you opened it', {
            code: 'version_conflict',
            currentVersion: row.version,
            updatedBy: row.updated_by,
            updatedAt: row.updated_at
        });
    }
}

async function insertPage(ctx, { id, title, template, schema, data }) {
    if (await getPage(ctx.db, id)) throw conflict('A page with that ID already exists');
    const now = Date.now();
    const user = ctx.user.username;
    await ctx.db.batch([
        ctx.db.prepare(
            `INSERT INTO pages (id, title, template, schema, draft, version, created_by, created_at, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        ).bind(id, title, template, JSON.stringify(schema), JSON.stringify(data), user, now, user, now),
        revisionStatement(ctx.db, { pageId: id, version: 1, kind: 'create', title, schema, data, user, now })
    ]);
    await audit(ctx, 'page.create', `page:${id}`, { template });
    return presentPage(await getPage(ctx.db, id));
}

export function register(router) {
    router.get('/api/templates', () => ({
        templates: Object.entries(TEMPLATES).map(([id, t]) => ({
            id, title: t.title, description: t.description, schema: t.schema, sample: t.sample
        }))
    }), SIGNED_IN);

    router.get('/api/pages', async (ctx) => {
        // Scheduled publishing also runs opportunistically while editors are active,
        // so schedules still fire without the cron workflow.
        if (hasRole(ctx.user, 'editor') && (await hasDueSchedules(ctx.db))) {
            ctx.waitUntil(runScheduled(ctx).catch((err) => console.error('scheduled publish failed', err?.message)));
        }
        return { pages: await listPages(ctx.db, ctx.user) };
    }, SIGNED_IN);

    router.post('/api/pages', async (ctx) => {
        await enforceRateLimit(ctx, 'write', ctx.user.username);
        const body = await readJson(ctx.request, { maxBytes: MAX_DRAFT_BYTES });
        const id = requirePageId(body.id);
        const title = requireTitle(body.title);

        let template = null;
        let schema = BLANK_SCHEMA;
        let data = { title, body: '' };
        if (body.template) {
            const found = TEMPLATES[body.template];
            if (!found) throw badRequest('Unknown template');
            template = body.template;
            schema = found.schema;
            data = body.useSample === false ? emptyContent(schema) : structuredClone(found.sample);
        }
        if (body.schema) {
            if (!hasRole(ctx.user, 'editor')) throw forbidden('Only editors can define custom schemas');
            schema = requireValidSchema(body.schema);
            data = emptyContent(schema);
        }
        return { page: await insertPage(ctx, { id, title, template, schema, data }) };
    }, SIGNED_IN);

    router.get('/api/pages/:id', async (ctx) => ({ page: presentPage(await requireEditablePage(ctx)) }), SIGNED_IN);

    router.put('/api/pages/:id', async (ctx) => {
        await enforceRateLimit(ctx, 'write', ctx.user.username);
        const row = await requireEditablePage(ctx);
        const body = await readJson(ctx.request, { maxBytes: MAX_DRAFT_BYTES + 64 * 1024 });
        requireBaseVersion(body, row);

        let schema = parseJson(row.schema);
        if (body.schema !== undefined) {
            if (!hasRole(ctx.user, 'editor')) throw forbidden('Only editors can change a page schema');
            schema = requireValidSchema(body.schema);
        }
        const title = body.title !== undefined ? requireTitle(body.title) : row.title;
        const data = requireValidData(schema, body.data !== undefined ? body.data : parseJson(row.draft));

        const now = Date.now();
        const user = ctx.user.username;
        const version = row.version + 1;
        const update = ctx.db.prepare(
            `UPDATE pages SET title = ?, schema = ?, draft = ?, version = ?, updated_by = ?, updated_at = ?
             WHERE id = ? AND version = ?`
        ).bind(title, JSON.stringify(schema), JSON.stringify(data), version, user, now, row.id, row.version);
        const revisions = await saveRevisionStatements(ctx.db, { pageId: row.id, version, title, schema, data, user, now });
        const [result] = await ctx.db.batch([update, ...revisions]);
        if (!result.meta.changes) throw conflict('This page changed since you opened it', { code: 'version_conflict' });

        await audit(ctx, 'page.save', `page:${row.id}`, { version });
        return { page: presentPage(await getPage(ctx.db, row.id)) };
    }, SIGNED_IN);

    router.delete('/api/pages/:id', async (ctx) => {
        const row = await getPage(ctx.db, ctx.params.id);
        if (!row) throw notFound('Page not found');
        if (row.published) await unpublishPages(ctx, [row], { reason: 'delete' });
        await ctx.db.batch([
            ctx.db.prepare('DELETE FROM pages WHERE id = ?').bind(row.id),
            ctx.db.prepare('DELETE FROM revisions WHERE page_id = ?').bind(row.id),
            ctx.db.prepare('DELETE FROM watches WHERE page_id = ?').bind(row.id)
        ]);
        await audit(ctx, 'page.delete', `page:${row.id}`);
        return { ok: true };
    }, { auth: 'editor' });

    router.post('/api/pages/:id/duplicate', async (ctx) => {
        await enforceRateLimit(ctx, 'write', ctx.user.username);
        const source = await requireEditablePage(ctx);
        const body = await readJson(ctx.request);
        const id = requirePageId(body.id);
        const title = requireTitle(body.title ?? `${source.title} (copy)`);
        const page = await insertPage(ctx, {
            id, title, template: source.template, schema: parseJson(source.schema), data: parseJson(source.draft)
        });
        return { page };
    }, SIGNED_IN);

    router.post('/api/pages/:id/workflow', async (ctx) => {
        const row = await requireEditablePage(ctx);
        const body = await readJson(ctx.request);
        const note = optionalString(body.note, 'Note', { max: 500 });
        const transitions = {
            submit: { from: 'draft', to: 'review', role: 'contributor' },
            withdraw: { from: 'review', to: 'draft', role: 'contributor' },
            reject: { from: 'review', to: 'draft', role: 'editor' }
        };
        const t = transitions[body.action];
        if (!t) throw badRequest('action must be submit, withdraw or reject');
        if (!hasRole(ctx.user, t.role)) throw forbidden();
        if (row.workflow !== t.from) throw conflict(`Page is not in ${t.from === 'review' ? 'review' : 'draft'}`);
        await run(ctx.db, 'UPDATE pages SET workflow = ? WHERE id = ?', t.to, row.id);
        await audit(ctx, `page.${body.action}`, `page:${row.id}`, note ? { note } : null);
        return { page: presentPage(await getPage(ctx.db, row.id)) };
    }, SIGNED_IN);

    router.get('/api/pages/:id/revisions', async (ctx) => {
        const row = await requireEditablePage(ctx);
        const revisions = await all(
            ctx.db,
            'SELECT id, version, kind, title, created_by, created_at, note FROM revisions WHERE page_id = ? ORDER BY id DESC',
            row.id
        );
        return {
            revisions: revisions.map((r) => ({
                id: r.id, version: r.version, kind: r.kind, title: r.title,
                createdBy: r.created_by, createdAt: r.created_at, note: r.note
            }))
        };
    }, SIGNED_IN);

    router.get('/api/pages/:id/revisions/:rev', async (ctx) => {
        const row = await requireEditablePage(ctx);
        const rev = await first(ctx.db, 'SELECT * FROM revisions WHERE id = ? AND page_id = ?', Number(ctx.params.rev), row.id);
        if (!rev) throw notFound('Revision not found');
        return {
            revision: {
                id: rev.id, version: rev.version, kind: rev.kind, title: rev.title,
                schema: parseJson(rev.schema), data: parseJson(rev.data),
                createdBy: rev.created_by, createdAt: rev.created_at, note: rev.note
            }
        };
    }, SIGNED_IN);

    router.post('/api/pages/:id/revisions/:rev/restore', async (ctx) => {
        const row = await requireEditablePage(ctx);
        const body = await readJson(ctx.request);
        requireBaseVersion(body, row);
        const rev = await first(ctx.db, 'SELECT * FROM revisions WHERE id = ? AND page_id = ?', Number(ctx.params.rev), row.id);
        if (!rev) throw notFound('Revision not found');
        if (rev.schema !== row.schema && !hasRole(ctx.user, 'editor')) {
            throw forbidden('This revision uses a different schema; ask an editor to restore it');
        }

        const now = Date.now();
        const user = ctx.user.username;
        const version = row.version + 1;
        const [result] = await ctx.db.batch([
            ctx.db.prepare(
                `UPDATE pages SET title = ?, schema = ?, draft = ?, version = ?, updated_by = ?, updated_at = ?
                 WHERE id = ? AND version = ?`
            ).bind(rev.title, rev.schema, rev.data, version, user, now, row.id, row.version),
            revisionStatement(ctx.db, {
                pageId: row.id, version, kind: 'restore', title: rev.title, schema: rev.schema, data: rev.data,
                user, now, note: `Restored version ${rev.version}`
            }),
            pruneRevisionsStatement(ctx.db, row.id)
        ]);
        if (!result.meta.changes) throw conflict('This page changed since you opened it', { code: 'version_conflict' });
        await audit(ctx, 'page.restore', `page:${row.id}`, { fromVersion: rev.version, version });
        return { page: presentPage(await getPage(ctx.db, row.id)) };
    }, SIGNED_IN);
}
