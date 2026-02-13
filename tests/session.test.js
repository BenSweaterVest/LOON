import { describe, it, expect } from 'vitest';
import { getBearerToken, getSessionFromRequest } from '../functions/lib/session.js';
import { createMockKV } from './helpers.js';

function makeRequest(authHeader = null) {
    const headers = new Headers();
    if (authHeader) {
        headers.set('Authorization', authHeader);
    }
    return new Request('http://localhost/api/test', { headers });
}

describe('Session Utilities', () => {
    it('getBearerToken should parse valid bearer tokens', () => {
        expect(getBearerToken(makeRequest('Bearer abc123'))).toBe('abc123');
        expect(getBearerToken(makeRequest('Bearer   xyz789   '))).toBe('xyz789');
    });

    it('getBearerToken should return null for invalid/missing auth', () => {
        expect(getBearerToken(makeRequest())).toBeNull();
        expect(getBearerToken(makeRequest('Basic abc'))).toBeNull();
        expect(getBearerToken(makeRequest('Bearer '))).toBeNull();
    });

    it('getSessionFromRequest should return parsed session when found', async () => {
        const db = createMockKV();
        await db.put('session:token1', JSON.stringify({ username: 'alice', role: 'editor' }));
        const session = await getSessionFromRequest(db, makeRequest('Bearer token1'));
        expect(session).toEqual({ username: 'alice', role: 'editor' });
    });

    it('getSessionFromRequest should return null when session missing', async () => {
        const db = createMockKV();
        const session = await getSessionFromRequest(db, makeRequest('Bearer missing'));
        expect(session).toBeNull();
    });
});
