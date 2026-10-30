/**
 * GET /api/audit?target=&actor=&action=&before=&limit=  (admin only)
 * Paginate with `before` set to the smallest id from the previous page.
 */

import { listAudit } from '../audit.js';
import { clampLimit, optionalInt } from '../validate.js';

export function register(router) {
    router.get('/api/audit', async (ctx) => {
        const q = ctx.query;
        const entries = await listAudit(ctx.db, {
            target: q.get('target') || null,
            actor: q.get('actor') || null,
            action: q.get('action') || null,
            before: optionalInt(q.get('before'), 'before', { min: 1 }),
            limit: clampLimit(q.get('limit'), 50, 200)
        });
        return { entries, nextBefore: entries.length ? entries[entries.length - 1].id : null };
    }, { auth: 'admin' });
}
