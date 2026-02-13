/**
 * Shared KV-backed rate-limit helper.
 */

function toRecentAttempts(rawAttempts, now, windowMs) {
    if (!Array.isArray(rawAttempts)) {
        return [];
    }
    return rawAttempts.filter((timestamp) => (
        Number.isFinite(timestamp) && now - timestamp < windowMs
    ));
}

export function buildRateLimitKey(scope, ip) {
    return `ratelimit:${scope}:${ip || 'unknown'}`;
}

export async function checkKvRateLimit(db, key, { maxAttempts, windowMs }) {
    if (!db) return true;

    const now = Date.now();

    const stored = await db.get(key);
    const attempts = stored ? JSON.parse(stored) : [];
    const recent = toRecentAttempts(attempts, now, windowMs);

    if (recent.length >= maxAttempts) {
        return false;
    }

    recent.push(now);
    await db.put(key, JSON.stringify(recent), {
        expirationTtl: Math.ceil(windowMs / 1000)
    });

    return true;
}
