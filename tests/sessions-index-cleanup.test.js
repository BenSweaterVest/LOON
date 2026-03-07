import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/sessions.js';
import { createMockKV } from './helpers.js';

function createGetRequest(token = 'admin-token') {
    return new Request('http://localhost/api/sessions', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        }
    });
}

describe('Sessions Index Cleanup', () => {
    let db;
    let env;

    beforeEach(async () => {
        db = createMockKV();
        env = { LOON_DB: db };
        await db.put('session:admin-token', JSON.stringify({
            username: 'admin',
            role: 'admin',
            created: Date.now(),
            ip: '127.0.0.1'
        }));

        await db.put('meta:index:sessions', JSON.stringify(['admin-token', 'stale-token']));
        await db.put('session_meta:stale-token', JSON.stringify({
            username: 'bob',
            role: 'editor',
            created: Date.now(),
            ip: '127.0.0.2'
        }));
        await db.put('meta:index:user_sessions:bob', JSON.stringify(['stale-token']));
        vi.restoreAllMocks();
    });

    it('removes stale tokens from session indexes during GET', async () => {
        const response = await onRequestGet({
            request: createGetRequest(),
            env
        });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.sessions.some(s => s.username === 'admin')).toBe(true);
        expect(body.sessions.some(s => s.username === 'bob')).toBe(false);

        const sessionIndex = await db.get('meta:index:sessions', { type: 'json' });
        expect(sessionIndex).toContain('admin-token');
        expect(sessionIndex).not.toContain('stale-token');

        const bobIndex = await db.get('meta:index:user_sessions:bob', { type: 'json' });
        expect(Array.isArray(bobIndex) ? bobIndex : []).not.toContain('stale-token');

        const staleMeta = await db.get('session_meta:stale-token');
        expect(staleMeta).toBeNull();
    });
});
