import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkKvRateLimit, buildRateLimitKey } from '../functions/lib/rate-limit.js';
import { createMockKV } from './helpers.js';

describe('Rate Limit Utilities', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('buildRateLimitKey should include scope and ip', () => {
        expect(buildRateLimitKey('save', '127.0.0.1')).toBe('ratelimit:save:127.0.0.1');
    });

    it('checkKvRateLimit should allow requests below limit', async () => {
        const db = createMockKV();
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

        const allowed = await checkKvRateLimit(db, 'ratelimit:test:ip1', {
            maxAttempts: 2,
            windowMs: 60_000
        });

        expect(allowed).toBe(true);
        expect(JSON.parse(await db.get('ratelimit:test:ip1'))).toEqual([1_700_000_000_000]);
    });

    it('checkKvRateLimit should reject requests at limit', async () => {
        const db = createMockKV();
        const now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);

        await db.put('ratelimit:test:ip2', JSON.stringify([now, now - 1_000]));

        const allowed = await checkKvRateLimit(db, 'ratelimit:test:ip2', {
            maxAttempts: 2,
            windowMs: 60_000
        });

        expect(allowed).toBe(false);
    });

    it('checkKvRateLimit should prune old attempts', async () => {
        const db = createMockKV();
        const now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);

        await db.put('ratelimit:test:ip3', JSON.stringify([now - 120_000]));

        const allowed = await checkKvRateLimit(db, 'ratelimit:test:ip3', {
            maxAttempts: 1,
            windowMs: 60_000
        });

        expect(allowed).toBe(true);
        expect(JSON.parse(await db.get('ratelimit:test:ip3'))).toEqual([now]);
    });

    it('checkKvRateLimit should fail open without db', async () => {
        const allowed = await checkKvRateLimit(null, 'ratelimit:test:none', {
            maxAttempts: 1,
            windowMs: 60_000
        });
        expect(allowed).toBe(true);
    });
});
