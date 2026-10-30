/**
 * Fixed-window rate limiting in D1. One row write per check.
 */

import { first, run } from './db/index.js';
import { tooMany } from './http.js';

export const LIMITS = {
    login: { max: 5, windowMs: 60_000 },
    setup: { max: 5, windowMs: 60_000 },
    passkey: { max: 10, windowMs: 60_000 },
    write: { max: 60, windowMs: 60_000 },
    publish: { max: 20, windowMs: 60_000 },
    upload: { max: 20, windowMs: 60_000 },
    feedback: { max: 5, windowMs: 60_000 }
};

/**
 * Count one hit for `scope:subject` and throw 429 when over the limit.
 */
export async function enforceRateLimit(ctx, scope, subject = ctx.ip || 'unknown') {
    const limit = LIMITS[scope];
    if (!limit) throw new Error(`Unknown rate limit scope: ${scope}`);
    const now = Date.now();
    const windowStart = now - limit.windowMs;
    const row = await first(
        ctx.db,
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
            window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
         RETURNING count`,
        `${scope}:${subject}`, now, windowStart, windowStart
    );
    if (Math.random() < 0.01) {
        ctx.waitUntil(run(ctx.db, 'DELETE FROM rate_limits WHERE window_start < ?', now - 3_600_000));
    }
    if (row && row.count > limit.max) throw tooMany();
}
