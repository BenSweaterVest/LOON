import { describe, it, expect } from 'vitest';
import { createMockKV, createMockEnv, createMockRequest } from './helpers.js';
import { onRequestPost as authLogin } from '../functions/api/auth.js';
import { onRequestPost as setupPost } from '../functions/api/setup.js';
import { onRequestGet as healthGet } from '../functions/api/health.js';
import passkeysHandler from '../functions/api/passkeys.js';

describe('KV Binding Compatibility Fallback', () => {
    it('auth login should work with KV binding when LOON_DB is missing', async () => {
        const kv = createMockKV();
        await kv.put(
            'user:admin',
            JSON.stringify({
                role: 'admin',
                bootstrap: true,
                password: 'StrongPassword123'
            })
        );

        const env = createMockEnv({ KV: kv });
        const request = createMockRequest('POST', {
            username: 'admin',
            password: 'StrongPassword123'
        });

        const response = await authLogin({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.token).toBeTruthy();
    });

    it('initial setup should work with KV binding when LOON_DB is missing', async () => {
        const kv = createMockKV();
        const env = createMockEnv({
            KV: kv,
            SETUP_TOKEN: 'setup-token-123'
        });

        const request = createMockRequest('POST', {
            setupToken: 'setup-token-123',
            username: 'admin',
            password: 'StrongPassword123'
        });

        const response = await setupPost({ request, env });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.token).toBeTruthy();

        const stored = await kv.get('user:admin', { type: 'json' });
        expect(stored.role).toBe('admin');
    });

    it('health endpoint should report kv_database=true when only KV binding exists', async () => {
        const env = createMockEnv({
            GITHUB_REPO: 'owner/repo',
            GITHUB_TOKEN: 'token-123',
            KV: {}
        });
        const request = createMockRequest('GET');

        const response = await healthGet({ request, env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.checks.kv_database).toBe(true);
    });

    it('passkeys challenge should work with KV binding when LOON_DB is missing', async () => {
        const kv = createMockKV();
        const sessionToken = 'session-token-abc';
        await kv.put(
            `session:${sessionToken}`,
            JSON.stringify({ username: 'alice', role: 'admin', created: Date.now() })
        );

        const env = createMockEnv({ KV: kv });
        const request = new Request('http://localhost/api/passkeys/register/challenge', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${sessionToken}`
            }
        });

        const response = await passkeysHandler.fetch(request, env);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.challenge).toBeTruthy();
        expect(body.challengeToken).toBeTruthy();
    });
});
