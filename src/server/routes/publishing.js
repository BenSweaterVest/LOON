/**
 * Publishing, scheduling, rollback and site settings.
 *
 *   POST   /api/publish                  (editor) { pages: [{ id, version? }] }
 *   POST   /api/unpublish                (editor) { pages: [id] }
 *   PUT    /api/pages/:id/schedule       (editor) { at }   epoch ms in the future
 *   DELETE /api/pages/:id/schedule       (editor)
 *   POST   /api/pages/:id/rollback       (editor) { revisionId, baseVersion }
 *   GET    /api/settings                 (signed in)
 *   PUT    /api/settings                 (admin) saves and publishes content/site.json
 *   POST   /api/republish                (admin) rewrite all published content from D1
 *   POST   /api/cron                     Authorization: Bearer <CRON_SECRET>
 */

import { first, parseJson, run } from '../db/index.js';
import { badRequest, conflict, notFound, readJson, unauthorized } from '../http.js';
import { timingSafeEqual } from '../crypto.js';
import { audit } from '../audit.js';
import { enforceRateLimit } from '../ratelimit.js';
import { getPage, presentPage } from '../pages.js';
import { publishPages, publishSettings, republishAll, runScheduled, unpublishPages } from '../publish/publisher.js';
import { DEFAULT_SETTINGS, validateSettings } from '../../shared/site.js';

const EDITOR = { auth: 'editor' };
const MAX_PAGES_PER_PUBLISH = 25;

export async function loadSettings(db) {
    const row = await first(db, "SELECT value FROM settings WHERE key = 'site'");
    return { ...DEFAULT_SETTINGS, ...parseJson(row?.value, {}) };
}

function requirePageList(value) {
    if (!Array.isArray(value) || !value.length) throw badRequest('pages must be a non-empty list');
    if (value.length > MAX_PAGES_PER_PUBLISH) throw badRequest(`Publish at most ${MAX_PAGES_PER_PUBLISH} pages at once`);
    return value.map((item) => (typeof item === 'string' ? { id: item } : item));
}

async function loadRows(db, items) {
    const rows = [];
    for (const item of items) {
        const row = await getPage(db, item?.id);
        if (!row) throw notFound(`Page not found: ${item?.id}`);
        if (item.version !== undefined && item.version !== row.version) {
            throw conflict(`"${row.title}" changed since you reviewed it`, { code: 'version_conflict', pageId: row.id, currentVersion: row.version });
        }
        rows.push(row);
    }
    return rows;
}

async function runMaintenance(db) {
    const now = Date.now();
    await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now),
        db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 3_600_000)
    ]);
}

export function register(router) {
    router.post('/api/publish', async (ctx) => {
        await enforceRateLimit(ctx, 'publish', ctx.user.username);
        const body = await readJson(ctx.request);
        const rows = await loadRows(ctx.db, requirePageList(body.pages));
        return publishPages(ctx, rows);
    }, EDITOR);

    router.post('/api/unpublish', async (ctx) => {
        await enforceRateLimit(ctx, 'publish', ctx.user.username);
        const body = await readJson(ctx.request);
        const rows = await loadRows(ctx.db, requirePageList(body.pages));
        return unpublishPages(ctx, rows);
    }, EDITOR);

    router.put('/api/pages/:id/schedule', async (ctx) => {
        const row = await getPage(ctx.db, ctx.params.id);
        if (!row) throw notFound('Page not found');
        const body = await readJson(ctx.request);
        const at = Number(body.at);
        if (!Number.isInteger(at) || at <= Date.now()) throw badRequest('Schedule time must be in the future');
        if (at > Date.now() + 366 * 86_400_000) throw badRequest('Schedule time must be within a year');
        await run(ctx.db, 'UPDATE pages SET scheduled_for = ? WHERE id = ?', at, row.id);
        await audit(ctx, 'page.schedule', `page:${row.id}`, { at });
        return { page: presentPage(await getPage(ctx.db, row.id)) };
    }, EDITOR);

    router.delete('/api/pages/:id/schedule', async (ctx) => {
        const row = await getPage(ctx.db, ctx.params.id);
        if (!row) throw notFound('Page not found');
        await run(ctx.db, 'UPDATE pages SET scheduled_for = NULL WHERE id = ?', row.id);
        await audit(ctx, 'page.unschedule', `page:${row.id}`);
        return { page: presentPage(await getPage(ctx.db, row.id)) };
    }, EDITOR);

    router.post('/api/pages/:id/rollback', async (ctx) => {
        await enforceRateLimit(ctx, 'publish', ctx.user.username);
        const row = await getPage(ctx.db, ctx.params.id);
        if (!row) throw notFound('Page not found');
        const body = await readJson(ctx.request);
        if (body.baseVersion !== row.version) throw conflict('This page changed since you opened it', { code: 'version_conflict', currentVersion: row.version });
        const rev = await first(ctx.db, "SELECT * FROM revisions WHERE id = ? AND page_id = ? AND kind IN ('publish', 'rollback')", Number(body.revisionId), row.id);
        if (!rev) throw notFound('Published revision not found');

        const now = Date.now();
        const version = row.version + 1;
        const result = await ctx.db.prepare(
            `UPDATE pages SET title = ?, schema = ?, draft = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`
        ).bind(rev.title, rev.schema, rev.data, version, ctx.user.username, now, row.id, row.version).run();
        if (!result.meta.changes) throw conflict('This page changed since you opened it', { code: 'version_conflict' });

        const updated = await getPage(ctx.db, row.id);
        const published = await publishPages(ctx, [updated], { kind: 'rollback', note: `Rolled back to version ${rev.version}` });
        return { ...published, page: presentPage(await getPage(ctx.db, row.id)) };
    }, EDITOR);

    router.get('/api/settings', async (ctx) => ({ settings: await loadSettings(ctx.db) }), { auth: 'contributor' });

    router.put('/api/settings', async (ctx) => {
        await enforceRateLimit(ctx, 'publish', ctx.user.username);
        const body = await readJson(ctx.request);
        const { settings, errors } = validateSettings({ ...(await loadSettings(ctx.db)), ...body });
        if (errors.length) throw badRequest('Settings are invalid', errors);
        const commit = await publishSettings(ctx, settings);
        await run(
            ctx.db,
            `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('site', ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
            JSON.stringify(settings), ctx.user.username, Date.now()
        );
        return { settings, commit };
    }, { auth: 'admin' });

    router.post('/api/republish', async (ctx) => {
        await enforceRateLimit(ctx, 'publish', ctx.user.username);
        return republishAll(ctx, await loadSettings(ctx.db));
    }, { auth: 'admin' });

    router.post('/api/cron', async (ctx) => {
        const header = ctx.request.headers.get('Authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (!ctx.config.cronSecret || !token || !timingSafeEqual(token, ctx.config.cronSecret)) {
            throw unauthorized('Invalid cron secret');
        }
        const published = await runScheduled(ctx);
        await runMaintenance(ctx.db);
        return { ok: true, published };
    }, { csrf: false });
}
