/**
 * Publishing: turn D1 drafts into files under content/ in one GitHub commit.
 *
 *   content/pages/<id>.json   published snapshot of a page
 *   content/media/<file>      images referenced by published pages
 *   content/site.json         site settings
 *
 * In development without GitHub credentials, publishing updates D1 only.
 */

import { all, first, parseJson } from '../db/index.js';
import { HttpError, badRequest } from '../http.js';
import { audit } from '../audit.js';
import { validateContent } from '../../shared/schema.js';
import { revisionStatement, pruneRevisionsStatement } from '../pages.js';
import { commitChanges } from './github.js';

export const MEDIA_REF = /\/media\/([a-f0-9]{16}\.(?:jpg|png|webp|gif|avif))/g;
const MAX_MEDIA_PER_COMMIT = 30;

export function pagePath(id) {
    return `content/pages/${id}.json`;
}

export function mediaPath(file) {
    return `content/media/${file}`;
}

function serialize(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

async function commit(ctx, changes, message) {
    if (!ctx.config.githubConfigured) {
        if (ctx.config.environment === 'development') return null;
        throw new HttpError(503, 'Publishing is not configured. Set GITHUB_REPO and GITHUB_TOKEN in your Pages project settings.');
    }
    return commitChanges(ctx.config, changes, message);
}

export function referencedMedia(value) {
    const files = new Set();
    for (const match of JSON.stringify(value).matchAll(MEDIA_REF)) files.add(match[1]);
    return files;
}

async function unpublishedMediaChanges(db, files) {
    if (!files.size) return { changes: [], ids: [] };
    const ids = [...files].map((f) => f.split('.')[0]);
    const rows = await all(
        db,
        `SELECT id, filename, data FROM media WHERE published_at IS NULL AND data IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`,
        ...ids
    );
    if (rows.length > MAX_MEDIA_PER_COMMIT) {
        throw badRequest(`Too many new images in one publish (${rows.length}). Publish fewer pages at a time (max ${MAX_MEDIA_PER_COMMIT} new images).`);
    }
    return {
        changes: rows.map((row) => ({ path: mediaPath(row.filename), base64: row.data })),
        ids: rows.map((row) => row.id)
    };
}

/**
 * Validate and publish the current drafts of the given page rows.
 * `actor` defaults to the signed-in user (the scheduler passes its own).
 */
export async function publishPages(ctx, rows, { actor = ctx.user.username, kind = 'publish', note = null } = {}) {
    if (!rows.length) throw badRequest('Nothing to publish');
    const now = Date.now();
    const snapshots = rows.map((row) => {
        const schema = parseJson(row.schema);
        const { data, errors } = validateContent(schema, parseJson(row.draft), { requireAll: true });
        if (errors.length) throw badRequest(`"${row.title}" cannot be published yet`, errors.map((e) => ({ ...e, pageId: row.id })));
        return { row, schema, data, file: { id: row.id, title: row.title, template: row.template, schema, data, version: row.version, publishedAt: now, publishedBy: actor } };
    });

    const media = await unpublishedMediaChanges(ctx.db, referencedMedia(snapshots.map((s) => s.data)));
    const changes = [
        ...snapshots.map((s) => ({ path: pagePath(s.row.id), text: serialize(s.file) })),
        ...media.changes
    ];
    const names = rows.map((r) => r.id);
    const message = `${kind === 'rollback' ? 'Roll back' : 'Publish'} ${names.length === 1 ? names[0] : `${names.length} pages`} by ${actor}\n\n${names.join('\n')}`;
    const sha = await commit(ctx, changes, message);

    const statements = [];
    for (const s of snapshots) {
        const published = JSON.stringify({ title: s.row.title, template: s.row.template, schema: s.schema, data: s.data });
        statements.push(
            ctx.db.prepare(
                `UPDATE pages SET published = ?, published_version = version, published_at = ?, published_by = ?,
                 published_commit = ?, workflow = 'draft', scheduled_for = NULL WHERE id = ?`
            ).bind(published, now, actor, sha, s.row.id),
            revisionStatement(ctx.db, { pageId: s.row.id, version: s.row.version, kind, title: s.row.title, schema: s.schema, data: s.data, user: actor, now, note }),
            pruneRevisionsStatement(ctx.db, s.row.id)
        );
    }
    for (const id of media.ids) statements.push(ctx.db.prepare('UPDATE media SET published_at = ? WHERE id = ?').bind(now, id));
    await ctx.db.batch(statements);

    for (const s of snapshots) await audit(ctx, `page.${kind}`, `page:${s.row.id}`, { version: s.row.version, commit: sha, by: actor });
    return { commit: sha, pages: names };
}

export async function unpublishPages(ctx, rows, { reason = 'unpublish' } = {}) {
    const published = rows.filter((r) => r.published);
    if (!published.length) return { commit: null, pages: [] };
    const names = published.map((r) => r.id);
    const sha = await commit(
        ctx,
        published.map((r) => ({ path: pagePath(r.id), delete: true })),
        `Unpublish ${names.length === 1 ? names[0] : `${names.length} pages`} by ${ctx.user.username}\n\n${names.join('\n')}`
    );
    const now = Date.now();
    await ctx.db.batch(published.flatMap((r) => [
        ctx.db.prepare(
            `UPDATE pages SET published = NULL, published_version = NULL, published_at = NULL, published_by = NULL,
             published_commit = NULL, scheduled_for = NULL WHERE id = ?`
        ).bind(r.id),
        revisionStatement(ctx.db, {
            pageId: r.id, version: r.version, kind: 'unpublish', title: r.title, schema: r.schema, data: r.draft,
            user: ctx.user.username, now, note: reason === 'delete' ? 'Unpublished before delete' : null
        })
    ]));
    for (const id of names) await audit(ctx, 'page.unpublish', `page:${id}`, { commit: sha, reason });
    return { commit: sha, pages: names };
}

export async function publishSettings(ctx, settings) {
    const sha = await commit(ctx, [{ path: 'content/site.json', text: serialize(settings) }], `Update site settings by ${ctx.user.username}`);
    await audit(ctx, 'settings.publish', 'settings', { commit: sha });
    return sha;
}

/**
 * Rewrite every published page, its media and the site settings from D1.
 * Recovers the content/ folder if the repository was reset or replaced.
 */
export async function republishAll(ctx, settings) {
    const rows = await all(ctx.db, 'SELECT id, published FROM pages WHERE published IS NOT NULL');
    const files = rows.map((row) => {
        const snapshot = parseJson(row.published);
        return { id: row.id, snapshot };
    });
    const mediaFiles = referencedMedia(files.map((f) => f.snapshot.data));
    const ids = [...mediaFiles].map((f) => f.split('.')[0]);
    const mediaRows = ids.length
        ? await all(ctx.db, `SELECT id, filename, data FROM media WHERE data IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids)
        : [];
    if (mediaRows.length > MAX_MEDIA_PER_COMMIT * 3) {
        throw badRequest('Too many images to republish in one commit');
    }
    const meta = await all(ctx.db, 'SELECT id, version, published_version, published_at, published_by FROM pages WHERE published IS NOT NULL');
    const metaById = new Map(meta.map((m) => [m.id, m]));
    const changes = [
        ...files.map(({ id, snapshot }) => {
            const m = metaById.get(id);
            return { path: pagePath(id), text: serialize({ id, ...snapshot, version: m.published_version, publishedAt: m.published_at, publishedBy: m.published_by }) };
        }),
        ...mediaRows.map((row) => ({ path: mediaPath(row.filename), base64: row.data })),
        { path: 'content/site.json', text: serialize(settings) }
    ];
    const sha = await commit(ctx, changes, `Republish all content by ${ctx.user.username}`);
    await audit(ctx, 'site.republish', 'site', { commit: sha, pages: files.length });
    return { commit: sha, pages: files.length, media: mediaRows.length };
}

/**
 * Publish every page whose schedule is due. Safe to call often: it does one
 * indexed query when nothing is due.
 */
export async function runScheduled(ctx) {
    const due = await all(ctx.db, 'SELECT * FROM pages WHERE scheduled_for IS NOT NULL AND scheduled_for <= ?', Date.now());
    const results = [];
    for (const row of due) {
        try {
            const result = await publishPages(ctx, [row], { actor: 'scheduler', note: 'Scheduled publish' });
            results.push({ id: row.id, ok: true, commit: result.commit });
        } catch (err) {
            // Leave the schedule in place only for transient failures; validation errors clear it.
            if (err.status === 400) {
                await ctx.db.prepare('UPDATE pages SET scheduled_for = NULL WHERE id = ?').bind(row.id).run();
                await audit(ctx, 'page.schedule_failed', `page:${row.id}`, { error: err.message, details: err.details ?? null });
            }
            results.push({ id: row.id, ok: false, error: err.message });
        }
    }
    return results;
}

export async function hasDueSchedules(db) {
    return !!(await first(db, 'SELECT 1 FROM pages WHERE scheduled_for IS NOT NULL AND scheduled_for <= ? LIMIT 1', Date.now()));
}
