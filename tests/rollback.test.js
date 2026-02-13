import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestPost } from '../functions/api/rollback.js';
import { createMockKV } from './helpers.js';

function createPostRequest(body, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return new Request('http://localhost/api/rollback', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Rollback Endpoint', () => {
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
        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'demo', commitSha: 'abcdef1' }),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(401);
        expect(body.error).toContain('Authentication required');
    });

    it('should reject contributor role', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));
        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'demo', commitSha: 'abcdef1' }, 'test-token'),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(403);
        expect(body.error).toContain('Admin or Editor role required');
    });

    it('should rollback content for admin', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(githubContentResponse({ title: 'Old' }, 'oldsha')) // historical
            .mockResolvedValueOnce(githubContentResponse({ title: 'Current' }, 'currentsha')) // current
            .mockResolvedValueOnce(new Response(JSON.stringify({
                commit: { sha: 'newsha123' }
            }), { status: 200 })); // put

        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'demo', commitSha: 'abcdef1234' }, 'test-token'),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.pageId).toBe('demo');
        expect(body.restoredFrom).toBe('abcdef1234');
        expect(body.commit).toBe('newsha123');
    });

    it('should return 404 when page or revision is missing', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response('not found', { status: 404 }));

        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'demo', commitSha: 'abcdef1234' }, 'test-token'),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(404);
        expect(body.error).toContain('not found');
    });
});
