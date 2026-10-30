/**
 * User administration (admin only).
 *   GET    /api/users
 *   POST   /api/users                          { username, role, displayName?, password? }
 *   PATCH  /api/users/:username                { role?, displayName?, disabled? }
 *   POST   /api/users/:username/reset-password -> { temporaryPassword }
 *   DELETE /api/users/:username
 *
 * Creating a user without a password, or resetting one, returns a one-time
 * temporary password and forces a change at next sign-in.
 */

import { run } from '../db/index.js';
import { badRequest, conflict, readJson } from '../http.js';
import { hashPassword, validatePassword } from '../auth/password.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { ROLES } from '../auth/rbac.js';
import { audit } from '../audit.js';
import { enforceRateLimit } from '../ratelimit.js';
import { optionalString, requireOneOf, requireUsername } from '../validate.js';
import { assertKeepsAnAdmin, getUser, listUsers, publicUser, requireUser, temporaryPassword } from '../users.js';

const ADMIN = { auth: 'admin' };

export function register(router) {
    router.get('/api/users', async (ctx) => ({ users: await listUsers(ctx.db) }), ADMIN);

    router.post('/api/users', async (ctx) => {
        await enforceRateLimit(ctx, 'write', ctx.user.username);
        const body = await readJson(ctx.request);
        const username = requireUsername(body.username);
        const role = requireOneOf(body.role, 'Role', ROLES);
        const displayName = optionalString(body.displayName, 'Display name', { max: 80 });
        if (await getUser(ctx.db, username)) throw conflict('That username is taken');

        let password = body.password;
        const generated = !password;
        if (generated) password = temporaryPassword();
        else validatePassword(password);

        const now = Date.now();
        await run(
            ctx.db,
            `INSERT INTO users (username, display_name, role, password_hash, must_change_password, created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            username, displayName, role, await hashPassword(password, ctx.config.pbkdf2Iterations),
            generated ? 1 : 0, now, ctx.user.username, now
        );
        await audit(ctx, 'user.create', `user:${username}`, { role });
        const user = publicUser(await getUser(ctx.db, username));
        return generated ? { user, temporaryPassword: password } : { user };
    }, ADMIN);

    router.patch('/api/users/:username', async (ctx) => {
        const target = await requireUser(ctx.db, ctx.params.username);
        const body = await readJson(ctx.request);
        const changes = {};
        if (body.role !== undefined) changes.role = requireOneOf(body.role, 'Role', ROLES);
        if (body.displayName !== undefined) changes.display_name = optionalString(body.displayName, 'Display name', { max: 80 });
        if (body.disabled !== undefined) {
            if (typeof body.disabled !== 'boolean') throw badRequest('disabled must be true or false');
            changes.disabled = body.disabled ? 1 : 0;
        }
        if (!Object.keys(changes).length) throw badRequest('Nothing to update');
        if (target.username === ctx.user.username && (changes.role && changes.role !== 'admin' || changes.disabled)) {
            throw conflict('You cannot demote or disable your own account');
        }
        await assertKeepsAnAdmin(ctx.db, target, {
            role: changes.role ?? target.role,
            disabled: changes.disabled !== undefined ? !!changes.disabled : !!target.disabled
        });

        const columns = Object.keys(changes);
        await run(
            ctx.db,
            `UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE username = ?`,
            ...columns.map((c) => changes[c]), Date.now(), target.username
        );
        // Sessions read the role from users on every request, so role changes
        // apply immediately; disabling also ends existing sessions.
        if (changes.disabled) await destroyUserSessions(ctx.db, target.username);
        await audit(ctx, 'user.update', `user:${target.username}`, changes);
        return { user: publicUser(await getUser(ctx.db, target.username)) };
    }, ADMIN);

    router.post('/api/users/:username/reset-password', async (ctx) => {
        const target = await requireUser(ctx.db, ctx.params.username);
        const password = temporaryPassword();
        await run(
            ctx.db,
            'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE username = ?',
            await hashPassword(password, ctx.config.pbkdf2Iterations), Date.now(), target.username
        );
        await destroyUserSessions(ctx.db, target.username);
        await audit(ctx, 'user.reset_password', `user:${target.username}`);
        return { temporaryPassword: password };
    }, ADMIN);

    router.delete('/api/users/:username', async (ctx) => {
        const target = await requireUser(ctx.db, ctx.params.username);
        if (target.username === ctx.user.username) throw conflict('You cannot delete your own account');
        await assertKeepsAnAdmin(ctx.db, target, { deleting: true });
        await run(ctx.db, 'DELETE FROM users WHERE username = ?', target.username);
        await audit(ctx, 'user.delete', `user:${target.username}`);
        return { ok: true };
    }, ADMIN);
}
