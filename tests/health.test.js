import { describe, it, expect } from 'vitest';
import { onRequestGet } from '../functions/api/health.js';

function createRequest() {
    return new Request('http://localhost/api/health');
}

describe('Health Endpoint', () => {
    it('should return degraded (503) when required configuration is missing', async () => {
        const response = await onRequestGet({
            request: createRequest(),
            env: {}
        });
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.status).toBe('degraded');
        expect(body.checks.github_repo).toBe(false);
        expect(body.checks.github_token).toBe(false);
        expect(body.checks.kv_database).toBe(false);
    });

    it('should return ok (200) when required configuration exists', async () => {
        const response = await onRequestGet({
            request: createRequest(),
            env: {
                GITHUB_REPO: 'owner/repo',
                GITHUB_TOKEN: 'token',
                LOON_DB: {}
            }
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.checks.github_repo).toBe(true);
        expect(body.checks.github_token).toBe(true);
        expect(body.checks.kv_database).toBe(true);
    });

    it('should treat KV fallback binding as healthy', async () => {
        const response = await onRequestGet({
            request: createRequest(),
            env: {
                GITHUB_REPO: 'owner/repo',
                GITHUB_TOKEN: 'token',
                KV: {}
            }
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.checks.kv_database).toBe(true);
    });

    it('should include a valid ISO timestamp', async () => {
        const response = await onRequestGet({
            request: createRequest(),
            env: {}
        });
        const body = await response.json();
        const parsed = new Date(body.timestamp);

        expect(Number.isNaN(parsed.getTime())).toBe(false);
    });

    it('should report passkey RP config checks', async () => {
        const response = await onRequestGet({
            request: createRequest(),
            env: {
                GITHUB_REPO: 'owner/repo',
                GITHUB_TOKEN: 'token',
                LOON_DB: {},
                RP_ID: 'example.com',
                RP_ORIGIN: 'https://example.com'
            }
        });
        const body = await response.json();

        expect(body.checks.passkeys_rp_id).toBe(true);
        expect(body.checks.passkeys_rp_origin).toBe(true);
        expect(body.checks.passkeys_ready).toBe(true);
    });
});
