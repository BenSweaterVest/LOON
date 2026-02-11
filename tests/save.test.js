import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestPost } from '../functions/api/save.js';
import { createMockKV } from './helpers.js';

function createRequest(body, token = 'test-token') {
    return new Request('http://localhost/api/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        },
        body: JSON.stringify(body)
    });
}

function githubGetResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Save Endpoint', () => {
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

    it('should return 500 when KV is not configured', async () => {
        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: { title: 'x' } }),
            env: { GITHUB_REPO: env.GITHUB_REPO, GITHUB_TOKEN: env.GITHUB_TOKEN }
        });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('KV database not configured');
    });

    it('should return 500 when GitHub is not configured', async () => {
        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: { title: 'x' } }),
            env: { LOON_DB: db }
        });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('GitHub not configured');
    });

    it('should return 401 for invalid session', async () => {
        global.fetch = vi.fn();
        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: { title: 'x' } }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toContain('Invalid or expired session');
    });

    it('should reject invalid pageId format', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const response = await onRequestPost({
            request: createRequest({ pageId: 'bad@id', content: { title: 'x' } }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid pageId format');
    });

    it('should reject oversized content', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const huge = { data: 'x'.repeat(2 * 1024 * 1024) };

        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: huge }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(413);
        expect(body.error).toContain('1MB');
    });

    it('should deny contributor editing content owned by another user', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));

        global.fetch = vi.fn().mockResolvedValueOnce(
            githubGetResponse({ _meta: { createdBy: 'bob' }, draft: { title: 'Existing' } }, 'sha-existing')
        );

        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: { title: 'Update' }, saveAs: 'draft' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toContain('Contributors can only edit content they created');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should force contributor saves to draft and commit successfully', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(
                githubGetResponse({ _meta: { createdBy: 'alice', created: '2026-01-01T00:00:00.000Z' } }, 'sha-existing')
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ commit: { sha: 'commit-sha-1' } }), { status: 200 })
            );

        const response = await onRequestPost({
            request: createRequest({ pageId: 'demo', content: { title: 'Draft update' }, saveAs: 'direct' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.saveType).toBe('draft');
        expect(body.status).toBe('draft');
    });

    it('should save direct content for admin and set published status', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 404 })) // existing file not found
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'commit-sha-2' } }), { status: 200 }));

        const response = await onRequestPost({
            request: createRequest({ pageId: 'newpage', content: { title: 'Hello' }, saveAs: 'direct' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.saveType).toBe('direct');
        expect(body.status).toBe('published');
        expect(body.commit).toBe('commit-sha-2');
    });
});
