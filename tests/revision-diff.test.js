import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/revision-diff.js';
import { createMockKV } from './helpers.js';

function request(query = '', token = 'test-token') {
    return new Request(`http://localhost/api/revision-diff${query}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Revision Diff Endpoint', () => {
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

    it('should return diff summary', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(githubContentResponse({ _meta: { createdBy: 'admin' }, title: 'A' }, 'headsha'))
            .mockResolvedValueOnce(githubContentResponse({ title: 'Old' }, 'oldsha'))
            .mockResolvedValueOnce(githubContentResponse({ title: 'New' }, 'newsha'));

        const res = await onRequestGet({
            request: request('?pageId=demo&from=abcdef1&to=1234567'),
            env
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.summary).toBeDefined();
        expect(Array.isArray(body.diff)).toBe(true);
    });

    it('should return 404 when page or ref is missing', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));

        const res = await onRequestGet({
            request: request('?pageId=demo&from=abcdef1&to=1234567'),
            env
        });
        const body = await res.json();
        expect(res.status).toBe(404);
        expect(body.error).toContain('not found');
    });
});
