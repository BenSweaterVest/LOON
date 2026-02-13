import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestPost } from '../functions/api/scheduled-publish.js';
import { createMockKV } from './helpers.js';

function request(token = 'test-token') {
    return new Request('http://localhost/api/scheduled-publish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Scheduled Publish Runner', () => {
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

    it('publishes due scheduled page', async () => {
        const due = new Date(Date.now() - 60000).toISOString();
        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify([{ type: 'dir', name: 'demo' }]), { status: 200 }))
            .mockResolvedValueOnce(githubContentResponse({
                draft: { title: 'Draft' },
                _meta: { workflowStatus: 'scheduled', scheduledFor: due }
            }, 'current-sha'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'newcommit' } }), { status: 200 }));

        const res = await onRequestPost({ request: request(), env });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.published.length).toBe(1);
        expect(body.published[0].pageId).toBe('demo');
    });

    it('emits structured security event on scheduled publish success when enabled', async () => {
        env.SECURITY_LOG_MODE = 'structured';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const due = new Date(Date.now() - 60000).toISOString();

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify([{ type: 'dir', name: 'demo' }]), { status: 200 }))
            .mockResolvedValueOnce(githubContentResponse({
                draft: { title: 'Draft' },
                _meta: { workflowStatus: 'scheduled', scheduledFor: due }
            }, 'current-sha'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'newcommit' } }), { status: 200 }));

        const res = await onRequestPost({ request: request(), env });
        expect(res.status).toBe(200);
        expect(logSpy.mock.calls.some(call => String(call[0]).includes('"event":"content_scheduled_published"'))).toBe(true);
    });
});
