import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestDelete } from '../functions/api/content.js';
import { createMockKV } from './helpers.js';

function createDeleteRequest(body, token = 'admin-token') {
    return new Request('http://localhost/api/content', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        },
        body: JSON.stringify(body)
    });
}

describe('Content Endpoint', () => {
    let db;
    let env;

    beforeEach(() => {
        db = createMockKV();
        env = {
            LOON_DB: db,
            GITHUB_REPO: 'test-owner/test-repo',
            GITHUB_TOKEN: 'test-token'
        };
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return 500 when KV is missing', async () => {
        const response = await onRequestDelete({
            request: createDeleteRequest({ pageId: 'demo' }),
            env: { GITHUB_REPO: env.GITHUB_REPO, GITHUB_TOKEN: env.GITHUB_TOKEN }
        });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('KV not configured');
    });

    it('should return 500 when GitHub is missing', async () => {
        const response = await onRequestDelete({
            request: createDeleteRequest({ pageId: 'demo' }),
            env: { LOON_DB: db }
        });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('GitHub not configured');
    });

    it('should return 401 without a valid session', async () => {
        const response = await onRequestDelete({
            request: createDeleteRequest({ pageId: 'demo' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toContain('Invalid or expired session');
    });

    it('should return 403 for contributor role', async () => {
        await db.put('session:admin-token', JSON.stringify({ username: 'alice', role: 'contributor' }));

        const response = await onRequestDelete({
            request: createDeleteRequest({ pageId: 'demo' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toContain('Requires admin or editor role');
    });

    it('should delete content and return commit sha for admin', async () => {
        await db.put('session:admin-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'file-sha' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'commit-sha' } }), { status: 200 }));

        const response = await onRequestDelete({
            request: createDeleteRequest({ pageId: 'demo' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.commit).toBe('commit-sha');
    });
});
