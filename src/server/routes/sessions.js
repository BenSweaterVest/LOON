/**
 * Session management.
 *   GET    /api/sessions          own sessions; admins may pass ?all=1
 *   DELETE /api/sessions/:id      revoke one (own, or any for admins)
 *   POST   /api/sessions/revoke-others
 */

import { first, run } from '../db/index.js';
import { forbidden, notFound } from '../http.js';
import { hasRole } from '../auth/rbac.js';
import { destroyUserSessions, listSessions } from '../auth/sessions.js';
import { audit } from '../audit.js';

function present(row, currentId) {
    return {
        id: row.id,
        username: row.username,
        method: row.method,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === currentId
    };
}

export function register(router) {
    router.get('/api/sessions', async (ctx) => {
        const everyone = ctx.query.get('all') === '1';
        if (everyone && !hasRole(ctx.user, 'admin')) throw forbidden();
        const rows = await listSessions(ctx.db, { username: everyone ? null : ctx.user.username });
        return { sessions: rows.map((row) => present(row, ctx.session.id)) };
    }, { auth: 'contributor' });

    router.delete('/api/sessions/:id', async (ctx) => {
        const row = await first(ctx.db, 'SELECT id, username FROM sessions WHERE id = ?', ctx.params.id);
        if (!row) throw notFound('Session not found');
        if (row.username !== ctx.user.username && !hasRole(ctx.user, 'admin')) throw notFound('Session not found');
        await run(ctx.db, 'DELETE FROM sessions WHERE id = ?', row.id);
        await audit(ctx, 'session.revoke', `user:${row.username}`);
        return { ok: true };
    }, { auth: 'contributor' });

    router.post('/api/sessions/revoke-others', async (ctx) => {
        await destroyUserSessions(ctx.db, ctx.user.username, { exceptId: ctx.session.id });
        await audit(ctx, 'session.revoke_others', `user:${ctx.user.username}`);
        return { ok: true };
    }, { auth: 'contributor' });
}
