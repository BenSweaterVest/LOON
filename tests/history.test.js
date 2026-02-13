import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/history.js';
import { createMockKV } from './helpers.js';

function createGetRequest(query = '', token = null) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return new Request(`http://localhost/api/history${query}`, { headers });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('History Endpoint', () => {
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

    it('should require authentication', async () => {
        const response = await onRequestGet({
            request: createGetRequest('?pageId=demo'),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(401);
        expect(body.error).toContain('No authorization token');
    });

    it('should return history for admin', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(githubContentResponse({ _meta: { createdBy: 'alice' } }, 'sha-current'))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                {
                    sha: 'abcdef123456',
                    html_url: 'https://github.com/test/repo/commit/abcdef',
                    commit: {
                        message: 'Update demo content',
                        author: { name: 'Alice', date: '2026-02-12T00:00:00Z' }
                    }
                }
            ]), { status: 200 }));

        const response = await onRequestGet({
            request: createGetRequest('?pageId=demo&limit=5', 'test-token'),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.pageId).toBe('demo');
        expect(body.total).toBe(1);
        expect(body.history[0].sha).toBe('abcdef123456');
    });

    it('should block contributor for non-owned page', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'bob', role: 'contributor' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(githubContentResponse({ _meta: { createdBy: 'alice' } }, 'sha-current'));

        const response = await onRequestGet({
            request: createGetRequest('?pageId=demo', 'test-token'),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toContain('Contributors can only view history');
    });

    it('should return 404 when page content is missing', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));

        const response = await onRequestGet({
            request: createGetRequest('?pageId=missing-page', 'test-token'),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(404);
        expect(body.error).toContain('Page not found');
    });
});
