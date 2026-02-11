import { describe, it, expect, beforeEach } from 'vitest';
import { createMockKV, createMockEnv, createMockRequest } from './helpers.js';
import { onRequestGet, onRequestPost } from '../functions/api/setup.js';

describe('Initial Setup Endpoint', () => {
    let db;
    let env;

    beforeEach(() => {
        db = createMockKV();
        env = createMockEnv({
            LOON_DB: db,
            SETUP_TOKEN: 'setup-token-123'
        });
    });

    it('GET should require setup when no admin exists', async () => {
        const request = createMockRequest('GET');
        const response = await onRequestGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.setupRequired).toBe(true);
        expect(body.setupTokenConfigured).toBe(true);
    });

    it('GET should not require setup when admin exists', async () => {
        await db.put('user:admin', JSON.stringify({ role: 'admin', hash: 'abc', salt: 'def' }));

        const request = createMockRequest('GET');
        const response = await onRequestGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.setupRequired).toBe(false);
    });

    it('POST should create first admin with hashed password and session', async () => {
        const request = createMockRequest('POST', {
            setupToken: 'setup-token-123',
            username: 'admin',
            password: 'StrongPassword123'
        });

        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.token).toBeTruthy();
        expect(body.role).toBe('admin');

        const storedUser = await db.get('user:admin', { type: 'json' });
        expect(storedUser.role).toBe('admin');
        expect(storedUser.hash).toBeTruthy();
        expect(storedUser.salt).toBeTruthy();
        expect(storedUser.password).toBeUndefined();
        expect(storedUser.bootstrap).toBeUndefined();

        const storedSession = await db.get(`session:${body.token}`, { type: 'json' });
        expect(storedSession.username).toBe('admin');
        expect(storedSession.role).toBe('admin');
    });

    it('POST should reject invalid setup token', async () => {
        const request = createMockRequest('POST', {
            setupToken: 'wrong-token',
            username: 'admin',
            password: 'StrongPassword123'
        });

        const response = await onRequestPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toContain('Invalid setup token');
    });

    it('POST should reject when setup already complete', async () => {
        await db.put('user:existing-admin', JSON.stringify({ role: 'admin', hash: 'x', salt: 'y' }));

        const request = createMockRequest('POST', {
            setupToken: 'setup-token-123',
            username: 'admin',
            password: 'StrongPassword123'
        });

        const response = await onRequestPost({ request, env });
        expect(response.status).toBe(409);
    });
});
