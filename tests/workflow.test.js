import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestPost } from '../functions/api/workflow.js';
import { createMockKV } from './helpers.js';

function createRequest(body, token = 'test-token') {
    return new Request('http://localhost/api/workflow', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });
}

function githubContentResponse(content, sha = 'sha123') {
    const encoded = Buffer.from(JSON.stringify(content)).toString('base64');
    return new Response(JSON.stringify({ content: encoded, sha }), { status: 200 });
}

describe('Workflow Endpoint', () => {
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

    it('should reject contributor', async () => {
        env.SECURITY_LOG_MODE = 'structured';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await db.put('session:test-token', JSON.stringify({ username: 'alice', role: 'contributor' }));
        const res = await onRequestPost({ request: createRequest({ pageId: 'demo', status: 'in_review' }), env });
        expect(res.status).toBe(403);
        expect(logSpy.mock.calls.some(call => String(call[0]).includes('"event":"workflow_permission_denied"'))).toBe(true);
    });

    it('should update workflow status for admin', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        global.fetch = vi.fn()
            .mockResolvedValueOnce(githubContentResponse({ _meta: {} }, 'current-sha'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'commit123' } }), { status: 200 }));

        const res = await onRequestPost({
            request: createRequest({ pageId: 'demo', status: 'in_review' }),
            env
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.status).toBe('in_review');
    });

    it('should reject invalid scheduledFor values', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const res = await onRequestPost({
            request: createRequest({ pageId: 'demo', status: 'scheduled', scheduledFor: 'not-a-date' }),
            env
        });
        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toContain('scheduledFor');
    });
});
