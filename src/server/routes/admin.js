/**
 * Diagnostics, backup and restore.
 *
 *   GET  /api/diagnostics[?github=1]          (admin) configuration and usage checks
 *   GET  /api/backup                          (admin) table list with row counts
 *   GET  /api/backup/:table?offset=&limit=    (admin) one chunk of rows
 *   POST /api/setup/restore                   { setupToken, table, rows }  only before setup
 *
 * Backups and restores move in chunks so every request stays well inside the
 * free plan's CPU limit. The admin UI stitches chunks into one JSON file.
 * Restore runs only on an empty instance (no users) and the users table must
 * be sent last, which completes setup.
 */

import { all, first } from '../db/index.js';
import { HttpError, badRequest, conflict, forbidden, readJson } from '../http.js';
import { timingSafeEqual } from '../crypto.js';
import { LATEST_VERSION } from '../db/schema.js';
import { enforceRateLimit } from '../ratelimit.js';
import { clampLimit } from '../validate.js';
import { checkAccess } from '../publish/github.js';
import { userCount } from '../users.js';

export const BACKUP_TABLES = ['settings', 'blocks', 'pages', 'revisions', 'media', 'feedback', 'audit', 'users', 'passkeys', 'recovery_codes', 'watches'];
const RESTORE_ORDER_LAST = ['users', 'passkeys', 'recovery_codes', 'watches'];

async function tableColumns(db, table) {
    const rows = await all(db, `PRAGMA table_info(${table})`);
    return rows.map((r) => r.name);
}

export function register(router) {
    router.get('/api/diagnostics', async (ctx) => {
        const c = ctx.config;
        const counts = await first(ctx.db, `SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM pages) AS pages,
            (SELECT COUNT(*) FROM pages WHERE published IS NOT NULL) AS published,
            (SELECT COUNT(*) FROM pages WHERE scheduled_for IS NOT NULL) AS scheduled,
            (SELECT COUNT(*) FROM media) AS media,
            (SELECT COALESCE(SUM(size), 0) FROM media) AS media_bytes,
            (SELECT COUNT(*) FROM feedback WHERE resolved_at IS NULL) AS open_feedback`);
        const checks = [
            { id: 'database', ok: true, label: 'D1 database bound as DB' },
            { id: 'github', ok: c.githubConfigured, label: 'GITHUB_REPO and GITHUB_TOKEN set', required: c.environment === 'production' },
            { id: 'cron', ok: !!c.cronSecret, label: 'CRON_SECRET set (needed for scheduled publishing)' },
            { id: 'site_url', ok: !!c.siteUrl, label: 'SITE_URL set (used for sitemap and canonical links)' }
        ];
        let github = null;
        if (ctx.query.get('github') === '1' && c.githubConfigured) {
            github = await checkAccess(c);
            checks.push({ id: 'github_access', ok: github.ok, label: 'GitHub token can write to the repository branch', required: true });
        }
        return {
            environment: c.environment,
            schemaVersion: LATEST_VERSION,
            repository: c.githubRepo || null,
            branch: c.githubBranch,
            checks,
            github,
            counts: {
                users: counts.users, pages: counts.pages, published: counts.published, scheduled: counts.scheduled,
                media: counts.media, mediaBytes: counts.media_bytes, openFeedback: counts.open_feedback
            }
        };
    }, { auth: 'admin' });

    router.get('/api/backup', async (ctx) => {
        const tables = [];
        for (const table of BACKUP_TABLES) {
            const row = await first(ctx.db, `SELECT COUNT(*) AS n FROM ${table}`);
            tables.push({ table, rows: row.n });
        }
        return { schemaVersion: LATEST_VERSION, tables };
    }, { auth: 'admin' });

    router.get('/api/backup/:table', async (ctx) => {
        const table = ctx.params.table;
        if (!BACKUP_TABLES.includes(table)) throw badRequest('Unknown table');
        const limit = clampLimit(ctx.query.get('limit'), table === 'media' ? 5 : 200, table === 'media' ? 20 : 500);
        const offset = Math.max(0, Number.parseInt(ctx.query.get('offset') || '0', 10) || 0);
        const rows = await all(ctx.db, `SELECT * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`, limit, offset);
        return { table, offset, rows, done: rows.length < limit };
    }, { auth: 'admin' });

    router.post('/api/setup/restore', async (ctx) => {
        await enforceRateLimit(ctx, 'write');
        if (!ctx.config.setupToken) throw new HttpError(503, 'SETUP_TOKEN is not configured');
        if ((await userCount(ctx.db)) > 0) throw conflict('Restore is only possible on a new, empty instance');
        const body = await readJson(ctx.request, { maxBytes: 4 * 1024 * 1024 });
        if (typeof body.setupToken !== 'string' || !timingSafeEqual(body.setupToken, ctx.config.setupToken)) {
            throw forbidden('Setup token is incorrect');
        }
        const { table, rows } = body;
        if (!BACKUP_TABLES.includes(table)) throw badRequest('Unknown table');
        if (!Array.isArray(rows) || rows.length > 500) throw badRequest('rows must be a list of at most 500 rows');
        if (RESTORE_ORDER_LAST.includes(table) && table !== 'users') {
            throw badRequest(`Restore ${table} together with users (send it in the same request as the final users chunk)`);
        }

        const columns = await tableColumns(ctx.db, table);
        const statement = (tbl, cols, row) => {
            const used = cols.filter((col) => row[col] !== undefined);
            if (!used.length) throw badRequest(`Empty row in ${tbl}`);
            return ctx.db.prepare(`INSERT OR REPLACE INTO ${tbl} (${used.join(', ')}) VALUES (${used.map(() => '?').join(', ')})`)
                .bind(...used.map((col) => row[col]));
        };
        const statements = rows.map((row) => statement(table, columns, row));

        // Users unlock the instance, so their dependents must arrive in the same batch.
        if (table === 'users') {
            for (const dependent of ['passkeys', 'recovery_codes', 'watches']) {
                const depRows = Array.isArray(body[dependent]) ? body[dependent] : [];
                if (depRows.length > 2000) throw badRequest(`Too many ${dependent} rows`);
                const depColumns = await tableColumns(ctx.db, dependent);
                for (const row of depRows) statements.push(statement(dependent, depColumns, row));
            }
            if (!rows.some((r) => r.role === 'admin' && !r.disabled)) throw badRequest('Backup must contain an active admin');
        }
        if (statements.length) await ctx.db.batch(statements);
        return { ok: true, table, restored: rows.length };
    });
}
