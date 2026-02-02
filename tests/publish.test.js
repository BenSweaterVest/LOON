/**
 * Tests for Publish Endpoint
 * functions/api/publish.js
 * @version 3.1.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestPost } from '../functions/api/publish.js';
import { createMockKV } from './helpers.js';

function createRequest(body, token = 'test-token') {
    return new Request('http://localhost/api/publish', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        },
        body: JSON.stringify(body)
    });
}

describe('Publish Endpoint', () => {
    let env;
    let db;

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

    it('should return 401 when no auth header', async () => {
        const request = new Request('http://localhost/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId: 'demo', action: 'publish' })
        });

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBeDefined();
    });

    it('should return 403 for contributor role', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));
        const request = createRequest({ pageId: 'demo', action: 'publish' });

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toContain('Only admins and editors');
    });

    it('should return 400 for invalid action', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const request = createRequest({ pageId: 'demo', action: 'noop' });

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('action');
    });

    it('should return 404 when page not found', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        global.fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }));

        const request = createRequest({ pageId: 'missing-page', action: 'publish' });
        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe('Page not found');
    });

    it('should return 400 when no draft exists to publish', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const content = { published: { title: 'Live' }, _meta: { status: 'published' } };
        const encoded = Buffer.from(JSON.stringify(content)).toString('base64');

        global.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ content: encoded, sha: 'abc123' }), { status: 200 })
        );

        const request = createRequest({ pageId: 'demo', action: 'publish' });
        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('No draft content');
    });

    it('should publish draft content successfully', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const content = { draft: { title: 'Draft' }, _meta: { status: 'draft' } };
        const encoded = Buffer.from(JSON.stringify(content)).toString('base64');

        global.fetch = vi.fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ content: encoded, sha: 'abc123' }), { status: 200 })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ commit: { sha: 'commit123' } }), { status: 200 })
            );

        const request = createRequest({ pageId: 'demo', action: 'publish' });
        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.status).toBe('published');
        expect(data.commit).toBe('commit123');
    });

    it('should unpublish content successfully', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const content = { published: { title: 'Live' }, draft: { title: 'Draft' }, _meta: { status: 'published' } };
        const encoded = Buffer.from(JSON.stringify(content)).toString('base64');

        global.fetch = vi.fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ content: encoded, sha: 'def456' }), { status: 200 })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ commit: { sha: 'commit456' } }), { status: 200 })
            );

        const request = createRequest({ pageId: 'demo', action: 'unpublish' });
        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.status).toBe('draft');
        expect(data.commit).toBe('commit456');
    });
});
