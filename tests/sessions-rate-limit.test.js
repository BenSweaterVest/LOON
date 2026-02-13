import { describe, it, expect } from 'vitest';
import { onRequestGet, onRequestDelete } from '../functions/api/sessions.js';
import { createMockKV, createMockRequest } from './helpers.js';

describe('Sessions Endpoint Rate Limit', () => {
    it('should return 429 for GET when sessions endpoint rate limit is exceeded', async () => {
        const db = createMockKV();
        const now = Date.now();
        const attempts = Array.from({ length: 30 }, () => now);
        await db.put('ratelimit:sessions:127.0.0.1', JSON.stringify(attempts));
        await db.put('session:admin-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const env = { LOON_DB: db };
        const request = createMockRequest('GET', null, {
            Authorization: 'Bearer admin-token'
        });

        const response = await onRequestGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(429);
        expect(body.error).toContain('Rate limit exceeded');
    });

    it('should return 429 for DELETE when sessions endpoint rate limit is exceeded', async () => {
        const db = createMockKV();
        const now = Date.now();
        const attempts = Array.from({ length: 30 }, () => now);
        await db.put('ratelimit:sessions:127.0.0.1', JSON.stringify(attempts));
        await db.put('session:admin-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const env = { LOON_DB: db };
        const request = createMockRequest('DELETE', { username: 'alice', all: true }, {
            Authorization: 'Bearer admin-token'
        });

        const response = await onRequestDelete({ request, env });
        const body = await response.json();

        expect(response.status).toBe(429);
        expect(body.error).toContain('Rate limit exceeded');
    });
});
