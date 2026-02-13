import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet, onRequestPost, onRequestDelete } from '../functions/api/watch.js';
import { createMockKV } from './helpers.js';

function request(method, body = null, token = 'test-token') {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    return new Request('http://localhost/api/watch', init);
}

describe('Watch Endpoint', () => {
    let db;
    let env;
    beforeEach(async () => {
        db = createMockKV();
        env = { LOON_DB: db };
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        vi.restoreAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    it('should add and list watched pages', async () => {
        const addRes = await onRequestPost({ request: request('POST', { pageId: 'demo' }), env });
        expect(addRes.status).toBe(200);
        const listRes = await onRequestGet({ request: request('GET'), env });
        const body = await listRes.json();
        expect(body.watchedPages).toContain('demo');
    });

    it('should remove watched page', async () => {
        await onRequestPost({ request: request('POST', { pageId: 'demo' }), env });
        const delRes = await onRequestDelete({ request: request('DELETE', { pageId: 'demo' }), env });
        expect(delRes.status).toBe(200);
        const listRes = await onRequestGet({ request: request('GET'), env });
        const body = await listRes.json();
        expect(body.watchedPages).not.toContain('demo');
    });
});

