import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet, onRequestPost } from '../functions/api/pages.js';
import { createMockKV } from './helpers.js';

function createGetRequest(query = '', headers = {}) {
    return new Request(`http://localhost/api/pages${query}`, { headers });
}

function createPostRequest(body, token = 'test-token') {
    return new Request('http://localhost/api/pages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        },
        body: JSON.stringify(body)
    });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Pages Endpoint', () => {
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

    it('GET should return 500 when GitHub config is missing', async () => {
        const response = await onRequestGet({
            request: createGetRequest(),
            env: { LOON_DB: db }
        });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('GitHub not configured');
    });

    it('GET minimal should list page directories from GitHub', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify([
                { type: 'dir', name: 'blog' },
                { type: 'dir', name: 'demo' },
                { type: 'file', name: 'README.md' }
            ]), { status: 200 })
        );

        const response = await onRequestGet({
            request: createGetRequest('?minimal=true'),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.total).toBe(2);
        expect(body.pages.map(p => p.pageId)).toEqual(['blog', 'demo']);
    });

    it('POST should require authentication', async () => {
        const request = new Request('http://localhost/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId: 'new-page' })
        });

        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toContain('Authentication required');
    });

    it('POST should reject contributor role', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));
        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'new-page' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toContain('Admin or Editor role required');
    });

    it('POST should reject invalid pageId format', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'bad@id' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid pageId format');
    });

    it('POST should return 409 when page already exists', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));

        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'existing-page' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body.error).toContain('already exists');
    });

    it('POST should create schema and content commits for admin', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response('{}', { status: 404 })) // checkPageExists
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'schema-sha' } }), { status: 200 })) // schema PUT
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'content-sha' } }), { status: 200 })); // content PUT

        const response = await onRequestPost({
            request: createPostRequest({ pageId: 'new-page', title: 'New Page' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.pageId).toBe('new-page');
        expect(body.schemaCommit).toBe('schema-sha');
        expect(body.contentCommit).toBe('content-sha');
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('GET should filter pages for contributor ownership', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { type: 'dir', name: 'page-a' },
                { type: 'dir', name: 'page-b' }
            ]), { status: 200 }))
            .mockResolvedValueOnce(githubContentResponse({ title: 'A' })) // schema page-a
            .mockResolvedValueOnce(githubContentResponse({ _meta: { createdBy: 'alice' } }, 'sha-a')) // content page-a
            .mockResolvedValueOnce(githubContentResponse({ title: 'B' })) // schema page-b
            .mockResolvedValueOnce(githubContentResponse({ _meta: { createdBy: 'bob' } }, 'sha-b')); // content page-b

        const response = await onRequestGet({
            request: createGetRequest('', { Authorization: 'Bearer test-token' }),
            env
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.pages).toHaveLength(1);
        expect(body.pages[0].pageId).toBe('page-a');
    });
});
