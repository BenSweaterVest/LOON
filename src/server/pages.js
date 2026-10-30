/**
 * Page records and revisions in D1.
 *
 * A page always has a draft (schema + data + title) and a version number that
 * increments on every change. `published` holds a snapshot of the last
 * published draft; `published_version` says which version that was.
 */

import { all, first, parseJson } from './db/index.js';
import { badRequest, notFound } from './http.js';
import { canEditPage, hasRole } from './auth/rbac.js';

export const MAX_REVISIONS_PER_PAGE = 50;
const COALESCE_WINDOW_MS = 10 * 60 * 1000;

export function pageStatus(row) {
    if (!row.published) return 'draft';
    return row.published_version === row.version ? 'published' : 'modified';
}

export function presentSummary(row) {
    return {
        id: row.id,
        title: row.title,
        template: row.template,
        status: pageStatus(row),
        workflow: row.workflow,
        version: row.version,
        scheduledFor: row.scheduled_for,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
        publishedBy: row.published_by
    };
}

export function presentPage(row) {
    const published = parseJson(row.published);
    return {
        ...presentSummary(row),
        schema: parseJson(row.schema, { fields: [] }),
        data: parseJson(row.draft, {}),
        published: published ? { ...published, version: row.published_version, commit: row.published_commit } : null
    };
}

const SUMMARY_COLUMNS = `id, title, template, workflow, version, scheduled_for, created_by, created_at,
    updated_by, updated_at, published IS NOT NULL AS published, published_version, published_at, published_by`;

export async function listPages(db, user) {
    const own = !hasRole(user, 'editor');
    const rows = own
        ? await all(db, `SELECT ${SUMMARY_COLUMNS} FROM pages WHERE created_by = ? ORDER BY updated_at DESC`, user.username)
        : await all(db, `SELECT ${SUMMARY_COLUMNS} FROM pages ORDER BY updated_at DESC`);
    return rows.map(presentSummary);
}

export async function getPage(db, id) {
    return first(db, 'SELECT * FROM pages WHERE id = ?', id);
}

/**
 * Load a page the current user may edit. Pages a contributor cannot edit are
 * reported as missing rather than forbidden, so IDs do not leak.
 */
export async function requireEditablePage(ctx, id = ctx.params.id) {
    const row = await getPage(ctx.db, id);
    if (!row || !canEditPage(ctx.user, row)) throw notFound('Page not found');
    return row;
}

export function revisionStatement(db, { pageId, version, kind, title, schema, data, user, note = null, now = Date.now() }) {
    return db.prepare(
        `INSERT INTO revisions (page_id, version, kind, title, schema, data, created_by, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pageId, version, kind, title, typeof schema === 'string' ? schema : JSON.stringify(schema),
        typeof data === 'string' ? data : JSON.stringify(data), user, now, note);
}

export function pruneRevisionsStatement(db, pageId) {
    return db.prepare(
        `DELETE FROM revisions WHERE page_id = ? AND id NOT IN (
            SELECT id FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT ?
         )`
    ).bind(pageId, pageId, MAX_REVISIONS_PER_PAGE);
}

/**
 * Record a draft save. Consecutive saves by the same person within ten
 * minutes update one revision instead of creating many.
 */
export async function saveRevisionStatements(db, { pageId, version, title, schema, data, user, now = Date.now() }) {
    const last = await first(db, 'SELECT id, kind, created_by, created_at FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1', pageId);
    if (last && last.kind === 'save' && last.created_by === user && now - last.created_at < COALESCE_WINDOW_MS) {
        return [db.prepare('UPDATE revisions SET version = ?, title = ?, schema = ?, data = ?, created_at = ? WHERE id = ?')
            .bind(version, title, JSON.stringify(schema), JSON.stringify(data), now, last.id)];
    }
    return [
        revisionStatement(db, { pageId, version, kind: 'save', title, schema, data, user, now }),
        pruneRevisionsStatement(db, pageId)
    ];
}

export function requireTitle(value) {
    if (typeof value !== 'string' || !value.trim()) throw badRequest('Title is required');
    if (value.trim().length > 200) throw badRequest('Title must be at most 200 characters');
    return value.trim();
}
