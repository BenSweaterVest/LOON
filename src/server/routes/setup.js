/**
 * First-run setup: create the first admin, gated by the SETUP_TOKEN secret.
 *   GET  /api/setup  -> { needsSetup, setupTokenConfigured }
 *   POST /api/setup  -> { user }   body: { setupToken, username, password, displayName? }
 */

import { HttpError, conflict, forbidden, readJson } from '../http.js';
import { timingSafeEqual } from '../crypto.js';
import { hashPassword, validatePassword } from '../auth/password.js';
import { createSession, toUser } from '../auth/sessions.js';
import { enforceRateLimit } from '../ratelimit.js';
import { audit } from '../audit.js';
import { optionalString, requireUsername } from '../validate.js';
import { getUser, userCount } from '../users.js';

export function register(router) {
    router.get('/api/setup', async (ctx) => ({
        needsSetup: (await userCount(ctx.db)) === 0,
        setupTokenConfigured: !!ctx.config.setupToken
    }));

    router.post('/api/setup', async (ctx) => {
        await enforceRateLimit(ctx, 'setup');
        if ((await userCount(ctx.db)) > 0) throw conflict('Setup is already complete. Sign in instead.');
        if (!ctx.config.setupToken) {
            throw new HttpError(503, 'SETUP_TOKEN is not configured. Add it as a secret in your Pages project settings, then redeploy.');
        }

        const body = await readJson(ctx.request);
        if (typeof body.setupToken !== 'string' || !timingSafeEqual(body.setupToken, ctx.config.setupToken)) {
            throw forbidden('Setup token is incorrect');
        }
        const username = requireUsername(body.username);
        validatePassword(body.password);
        const displayName = optionalString(body.displayName, 'Display name', { max: 80 });

        const now = Date.now();
        const hash = await hashPassword(body.password, ctx.config.pbkdf2Iterations);
        // Conditional insert closes the race between two concurrent setup requests.
        const result = await ctx.db.prepare(
            `INSERT INTO users (username, display_name, role, password_hash, created_at, updated_at, password_changed_at)
             SELECT ?, ?, 'admin', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`
        ).bind(username, displayName, hash, now, now, now).run();
        if (!result.meta.changes) throw conflict('Setup is already complete. Sign in instead.');

        await createSession(ctx, username);
        const user = toUser(await getUser(ctx.db, username));
        ctx.user = user;
        await audit(ctx, 'setup.complete', `user:${username}`);
        return { user };
    });
}
