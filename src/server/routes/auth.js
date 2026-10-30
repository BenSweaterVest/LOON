/**
 * Password auth and the current user.
 *   POST /api/auth/login      { username, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me         -> { user, session, passkeys } or { user: null }
 *   POST /api/auth/password   { currentPassword, newPassword }
 */

import { first, run } from '../db/index.js';
import { badRequest, readJson, unauthorized } from '../http.js';
import { hashPassword, needsRehash, validatePassword, verifyPassword } from '../auth/password.js';
import { createSession, destroyCurrentSession, destroyUserSessions, toUser } from '../auth/sessions.js';
import { enforceRateLimit } from '../ratelimit.js';
import { audit } from '../audit.js';
import { getUser } from '../users.js';
import { USERNAME_PATTERN } from '../validate.js';

export function register(router) {
    router.post('/api/auth/login', async (ctx) => {
        await enforceRateLimit(ctx, 'login');
        const body = await readJson(ctx.request, { maxBytes: 4096 });
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!username || !password) throw badRequest('Username and password are required');

        const row = USERNAME_PATTERN.test(username) ? await getUser(ctx.db, username) : null;
        if (row) await enforceRateLimit(ctx, 'login', `user:${username}`);
        // Always run one hash so response timing does not reveal which usernames exist.
        const valid = row
            ? await verifyPassword(password, row.password_hash)
            : (await hashPassword(password.slice(0, 256), ctx.config.pbkdf2Iterations), false);
        if (!row || !valid || row.disabled) {
            await audit(ctx, 'auth.login_failed', row ? `user:${username}` : null, { username: username.slice(0, 32) });
            throw unauthorized('Incorrect username or password');
        }

        const now = Date.now();
        if (needsRehash(row.password_hash, ctx.config.pbkdf2Iterations)) {
            const rehashed = await hashPassword(password, ctx.config.pbkdf2Iterations);
            await run(ctx.db, 'UPDATE users SET password_hash = ?, last_login_at = ? WHERE username = ?', rehashed, now, username);
        } else {
            await run(ctx.db, 'UPDATE users SET last_login_at = ? WHERE username = ?', now, username);
        }

        const session = await createSession(ctx, username, 'password');
        ctx.user = toUser(row);
        await audit(ctx, 'auth.login', `user:${username}`, { method: 'password' });
        return { user: ctx.user, session: { expiresAt: session.expiresAt } };
    });

    router.post('/api/auth/logout', async (ctx) => {
        if (ctx.user) await audit(ctx, 'auth.logout', `user:${ctx.user.username}`);
        await destroyCurrentSession(ctx);
        return { ok: true };
    }, { session: 'optional' });

    router.get('/api/auth/me', async (ctx) => {
        if (!ctx.user) return { user: null };
        const passkeys = await first(ctx.db, 'SELECT COUNT(*) AS n FROM passkeys WHERE username = ?', ctx.user.username);
        const codes = await first(ctx.db, 'SELECT COUNT(*) AS n FROM recovery_codes WHERE username = ? AND used_at IS NULL', ctx.user.username);
        return {
            user: ctx.user,
            session: { method: ctx.session.method, expiresAt: ctx.session.expiresAt },
            security: { passkeys: passkeys.n, recoveryCodesRemaining: codes.n }
        };
    }, { session: 'optional' });

    router.post('/api/auth/password', async (ctx) => {
        await enforceRateLimit(ctx, 'login', `user:${ctx.user.username}`);
        const body = await readJson(ctx.request, { maxBytes: 4096 });
        const row = await getUser(ctx.db, ctx.user.username);
        // Recovery-code sessions exist precisely because the password is lost.
        if (ctx.session.method !== 'recovery' && !(await verifyPassword(body.currentPassword, row.password_hash))) {
            throw badRequest('Current password is incorrect');
        }
        validatePassword(body.newPassword);
        if (body.newPassword === body.currentPassword) throw badRequest('New password must be different');

        const now = Date.now();
        const hash = await hashPassword(body.newPassword, ctx.config.pbkdf2Iterations);
        await run(
            ctx.db,
            'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE username = ?',
            hash, now, now, ctx.user.username
        );
        await destroyUserSessions(ctx.db, ctx.user.username, { exceptId: ctx.session.id });
        await audit(ctx, 'auth.password_changed', `user:${ctx.user.username}`);
        return { ok: true };
    }, { auth: 'contributor', allowPasswordChangePending: true });
}
