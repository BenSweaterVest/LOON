/**
 * Media library. Images are resized and base64-encoded in the browser, stored
 * in D1 as text, and committed to content/media/ when a page using them is
 * published. The server never re-encodes image bytes, which keeps requests
 * inside the free plan's CPU budget.
 *
 *   POST   /api/media?filename=&alt=&width=&height=   body: base64 text  (signed in)
 *   GET    /api/media                                 list               (signed in)
 *   GET    /api/media/:id/data                        base64 text        (signed in)
 *   PATCH  /api/media/:id                             { alt }            (signed in, own or editor)
 *   DELETE /api/media/:id                             (editor) only when no page uses it
 */

import { all, first, run } from '../db/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, readJson } from '../http.js';
import { sha256Hex } from '../crypto.js';
import { hasRole } from '../auth/rbac.js';
import { audit } from '../audit.js';
import { enforceRateLimit } from '../ratelimit.js';
import { optionalInt, optionalString } from '../validate.js';
import { mediaPath } from '../publish/publisher.js';
import { commitChanges } from '../publish/github.js';

export const MAX_MEDIA_BYTES = 1.5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;

// Leading base64 characters of each format's magic bytes.
const SIGNATURES = [
    { mime: 'image/jpeg', ext: 'jpg', prefix: '/9j/' },
    { mime: 'image/png', ext: 'png', prefix: 'iVBORw0KGgo' },
    { mime: 'image/gif', ext: 'gif', prefix: 'R0lGOD' },
    { mime: 'image/webp', ext: 'webp', test: (b64) => b64.startsWith('UklGR') && atob(b64.slice(8, 16)).slice(0, 4) === 'WEBP' },
    { mime: 'image/avif', ext: 'avif', test: (b64) => atob(b64.slice(0, 16)).slice(4, 12) === 'ftypavif' }
];

function detect(base64) {
    return SIGNATURES.find((s) => (s.test ? s.test(base64) : base64.startsWith(s.prefix))) || null;
}

function present(row) {
    return {
        id: row.id,
        filename: row.filename,
        url: `/media/${row.filename}`,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        alt: row.alt,
        createdBy: row.created_by,
        createdAt: row.created_at,
        publishedAt: row.published_at
    };
}

const COLUMNS = 'id, filename, mime, size, width, height, alt, created_by, created_at, published_at';

export function register(router) {
    router.post('/api/media', async (ctx) => {
        await enforceRateLimit(ctx, 'upload', ctx.user.username);
        const declared = Number(ctx.request.headers.get('Content-Length') || 0);
        if (declared > MAX_BASE64_LENGTH + 16) throw new HttpError(413, 'Image exceeds 1.5MB after resizing');
        const base64 = (await ctx.request.text()).trim();
        if (base64.length > MAX_BASE64_LENGTH) throw new HttpError(413, 'Image exceeds 1.5MB after resizing');
        if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            throw badRequest('Body must be base64-encoded image data');
        }
        const type = detect(base64);
        if (!type) throw badRequest('Only JPEG, PNG, WebP, GIF and AVIF images are supported');

        const id = (await sha256Hex(base64)).slice(0, 16);
        const existing = await first(ctx.db, `SELECT ${COLUMNS} FROM media WHERE id = ?`, id);
        if (existing) return { media: present(existing), duplicate: true };

        const size = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
        const original = optionalString(ctx.query.get('filename'), 'Filename', { max: 200 });
        await run(
            ctx.db,
            `INSERT INTO media (id, filename, mime, size, width, height, alt, data, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id, `${id}.${type.ext}`, type.mime, size,
            optionalInt(ctx.query.get('width'), 'width', { min: 1, max: 20000 }),
            optionalInt(ctx.query.get('height'), 'height', { min: 1, max: 20000 }),
            optionalString(ctx.query.get('alt'), 'Alt text', { max: 300 }),
            base64, ctx.user.username, Date.now()
        );
        await audit(ctx, 'media.upload', `media:${id}`, { original, size });
        return { media: present(await first(ctx.db, `SELECT ${COLUMNS} FROM media WHERE id = ?`, id)) };
    }, { auth: 'contributor' });

    router.get('/api/media', async (ctx) => ({
        media: (await all(ctx.db, `SELECT ${COLUMNS} FROM media ORDER BY created_at DESC LIMIT 500`)).map(present)
    }), { auth: 'contributor' });

    router.get('/api/media/:id/data', async (ctx) => {
        const row = await first(ctx.db, 'SELECT mime, data FROM media WHERE id = ?', ctx.params.id);
        if (!row || !row.data) throw notFound('Image not found');
        return new Response(row.data, {
            headers: { 'Content-Type': 'text/plain; charset=us-ascii', 'X-Media-Type': row.mime, 'Cache-Control': 'private, max-age=86400' }
        });
    }, { auth: 'contributor' });

    router.patch('/api/media/:id', async (ctx) => {
        const row = await first(ctx.db, `SELECT ${COLUMNS} FROM media WHERE id = ?`, ctx.params.id);
        if (!row) throw notFound('Image not found');
        if (row.created_by !== ctx.user.username && !hasRole(ctx.user, 'editor')) throw forbidden();
        const body = await readJson(ctx.request);
        const alt = optionalString(body.alt, 'Alt text', { max: 300 });
        await run(ctx.db, 'UPDATE media SET alt = ? WHERE id = ?', alt, row.id);
        return { media: present({ ...row, alt }) };
    }, { auth: 'contributor' });

    router.delete('/api/media/:id', async (ctx) => {
        const row = await first(ctx.db, `SELECT ${COLUMNS} FROM media WHERE id = ?`, ctx.params.id);
        if (!row) throw notFound('Image not found');
        const pattern = `%/media/${row.filename}%`;
        const users = await all(ctx.db, 'SELECT id FROM pages WHERE draft LIKE ? OR published LIKE ? LIMIT 10', pattern, pattern);
        if (users.length) throw conflict('This image is used by pages', { pages: users.map((p) => p.id) });
        if (row.published_at && ctx.config.githubConfigured) {
            await commitChanges(ctx.config, [{ path: mediaPath(row.filename), delete: true }], `Delete media ${row.filename} by ${ctx.user.username}`);
        }
        await run(ctx.db, 'DELETE FROM media WHERE id = ?', row.id);
        await audit(ctx, 'media.delete', `media:${row.id}`);
        return { ok: true };
    }, { auth: 'editor' });
}
