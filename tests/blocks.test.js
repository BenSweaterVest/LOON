import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/blocks.js';
import { createMockKV } from './helpers.js';

function request(token = 'test-token') {
    return new Request('http://localhost/api/blocks', {
        headers: { Authorization: `Bearer ${token}` }
    });
}

describe('Blocks Endpoint', () => {
    let db;
    let env;

    beforeEach(async () => {
        db = createMockKV();
        env = {
            LOON_DB: db,
            GITHUB_REPO: 'test-owner/test-repo',
            GITHUB_TOKEN: 'test-token'
        };
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        vi.restoreAllMocks();
    });

    afterEach(() => vi.restoreAllMocks());

    it('should return default blocks when repo blocks missing', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }));
        const res = await onRequestGet({ request: request(), env });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.blocks.length).toBeGreaterThan(0);
        expect(body.source).toBe('default');
    });
});

