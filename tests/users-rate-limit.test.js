import { describe, it, expect } from 'vitest';
import { onRequest } from '../functions/api/users.js';
import { createMockKV, createMockRequest } from './helpers.js';

describe('Users Endpoint Rate Limit', () => {
    it('should return 429 when users endpoint rate limit is exceeded', async () => {
        const db = createMockKV();
        const now = Date.now();
        const attempts = Array.from({ length: 30 }, () => now);
        await db.put('ratelimit:users:127.0.0.1', JSON.stringify(attempts));
        await db.put('session:admin-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const env = { LOON_DB: db };
        const request = createMockRequest('GET', null, {
            Authorization: 'Bearer admin-token'
        });

        const response = await onRequest({ request, env });
        const body = await response.json();

        expect(response.status).toBe(429);
        expect(body.error).toContain('Rate limit exceeded');
    });
});
