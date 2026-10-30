/**
 * Append-only audit log with opportunistic retention cleanup.
 */

import { all, run } from './db/index.js';

export async function audit(ctx, action, target = null, details = null) {
    await run(
        ctx.db,
        'INSERT INTO audit (at, actor, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
        Date.now(),
        ctx.user?.username ?? null,
        action,
        target,
        details ? JSON.stringify(details) : null,
        ctx.ip || null
    );
    if (Math.random() < 0.02) {
        const cutoff = Date.now() - ctx.config.auditRetentionDays * 86_400_000;
        ctx.waitUntil(run(ctx.db, 'DELETE FROM audit WHERE at < ?', cutoff));
    }
}

export async function listAudit(db, { target = null, actor = null, action = null, before = null, limit = 50 } = {}) {
    const where = [];
    const params = [];
    if (target) { where.push('target = ?'); params.push(target); }
    if (actor) { where.push('actor = ?'); params.push(actor); }
    if (action) { where.push('action = ?'); params.push(action); }
    if (before) { where.push('id < ?'); params.push(before); }
    const sql = `SELECT id, at, actor, action, target, details, ip FROM audit
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY id DESC LIMIT ?`;
    const rows = await all(db, sql, ...params, Math.min(200, Math.max(1, limit)));
    return rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}
