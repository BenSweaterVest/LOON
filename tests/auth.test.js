import { describe, it, expect, beforeEach } from 'vitest';
import {
    onRequestPost,
    onRequestGet,
    onRequestDelete,
    onRequestPatch
} from '../functions/api/auth.js';
import { createMockKV, createMockEnv, createMockRequest } from './helpers.js';

function authHeader(token) {
    return { Authorization: `Bearer ${token}` };
}

describe('Auth Endpoint', () => {
    let db;
    let env;

    beforeEach(() => {
        db = createMockKV();
        env = createMockEnv({ LOON_DB: db });
    });

    it('POST should return 500 when KV binding is missing', async () => {
        const request = createMockRequest('POST', { username: 'admin', password: 'password123' });
        const response = await onRequestPost({ request, env: createMockEnv() });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('KV database not configured');
    });

    it('POST should reject missing username/password', async () => {
        const request = createMockRequest('POST', { username: 'admin' });
        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('Username and password required');
    });

    it('POST should reject invalid username format', async () => {
        const request = createMockRequest('POST', { username: 'bad@name', password: 'password123' });
        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid username format');
    });

    it('POST should reject invalid credentials', async () => {
        const request = createMockRequest('POST', { username: 'admin', password: 'password123' });
        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toContain('Invalid credentials');
    });

    it('POST should login bootstrap user and upgrade stored password', async () => {
        await db.put('user:admin', JSON.stringify({
            role: 'admin',
            bootstrap: true,
            password: 'StrongPassword123'
        }));

        const request = createMockRequest('POST', { username: 'admin', password: 'StrongPassword123' });
        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.token).toBeTruthy();
        expect(body.role).toBe('admin');

        const upgraded = await db.get('user:admin', { type: 'json' });
        expect(upgraded.bootstrap).toBeUndefined();
        expect(upgraded.password).toBeUndefined();
        expect(upgraded.hash).toBeTruthy();
        expect(upgraded.salt).toBeTruthy();
    });

    it('GET should return 401 when token is missing', async () => {
        const request = createMockRequest('GET');
        const response = await onRequestGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.valid).toBe(false);
    });

    it('GET should return valid session details for active token', async () => {
        const token = 'token-123';
        await db.put(`session:${token}`, JSON.stringify({
            username: 'admin',
            role: 'admin',
            created: Date.now()
        }));

        const request = createMockRequest('GET', null, authHeader(token));
        const response = await onRequestGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.valid).toBe(true);
        expect(body.username).toBe('admin');
        expect(body.role).toBe('admin');
        expect(body.expiresIn).toBeGreaterThan(0);
    });

    it('DELETE should return 400 when token is missing', async () => {
        const request = createMockRequest('DELETE');
        const response = await onRequestDelete({ request, env });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('No token provided');
    });

    it('DELETE should remove session and return success', async () => {
        const token = 'token-delete';
        await db.put(`session:${token}`, JSON.stringify({ username: 'admin', role: 'admin', created: Date.now() }));

        const request = createMockRequest('DELETE', null, authHeader(token));
        const response = await onRequestDelete({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);

        const removed = await db.get(`session:${token}`);
        expect(removed).toBeNull();
    });

    it('PATCH should return 401 when token is missing', async () => {
        const request = createMockRequest('PATCH', { currentPassword: 'x', newPassword: 'newPassword123' });
        const response = await onRequestPatch({ request, env });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toContain('No token provided');
    });

    it('PATCH should reject weak new password', async () => {
        const token = 'token-patch';
        await db.put(`session:${token}`, JSON.stringify({ username: 'admin', role: 'admin', created: Date.now() }));
        await db.put('user:admin', JSON.stringify({ role: 'admin', bootstrap: true, password: 'CurrentPass123' }));

        const request = createMockRequest(
            'PATCH',
            { currentPassword: 'CurrentPass123', newPassword: 'short' },
            authHeader(token)
        );
        const response = await onRequestPatch({ request, env });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('at least 8 characters');
    });

    it('PATCH should update password when current password is valid', async () => {
        const token = 'token-patch-ok';
        await db.put(`session:${token}`, JSON.stringify({ username: 'admin', role: 'admin', created: Date.now() }));
        await db.put('user:admin', JSON.stringify({ role: 'admin', bootstrap: true, password: 'CurrentPass123' }));

        const request = createMockRequest(
            'PATCH',
            { currentPassword: 'CurrentPass123', newPassword: 'NewPass456' },
            authHeader(token)
        );
        const response = await onRequestPatch({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);

        const updated = await db.get('user:admin', { type: 'json' });
        expect(updated.password).toBeUndefined();
        expect(updated.hash).toBeTruthy();
        expect(updated.salt).toBeTruthy();
    });
});
