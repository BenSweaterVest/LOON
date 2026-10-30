import { describe, it, expect } from 'vitest';
import { Client, createEnv } from './helpers.js';
import { Router } from '../src/server/router.js';
import { migrate } from '../src/server/db/index.js';
import { LATEST_VERSION } from '../src/server/db/schema.js';
import { handle } from '../src/server/app.js';

describe('router', () => {
    it('matches params and reports allowed methods', () => {
        const r = new Router().get('/api/pages/:id', () => 'x').post('/api/pages', () => 'y');
        expect(r.match('GET', '/api/pages/home').params).toEqual({ id: 'home' });
        expect(r.match('GET', '/api/pages/home/').params).toEqual({ id: 'home' });
        expect(r.match('DELETE', '/api/pages').allowed).toEqual(['POST']);
        expect(r.match('GET', '/api/nope')).toBeNull();
    });
});

describe('migrations', () => {
    it('are idempotent and record the schema version', async () => {
        const env = await createEnv();
        await migrate(env.DB);
        const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
        expect(Number(row.value)).toBe(LATEST_VERSION);
    });
});

describe('pipeline', () => {
    it('serves health', async () => {
        const client = new Client(await createEnv());
        const res = await client.get('/api/health');
        expect(res.status).toBe(200);
        expect(res.data.ok).toBe(true);
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('returns 404 and 405', async () => {
        const client = new Client(await createEnv());
        expect((await client.get('/api/missing')).status).toBe(404);
        const res = await client.post('/api/health', {});
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET');
    });

    it('explains a missing D1 binding', async () => {
        const res = await handle(new Request('https://loon.test/api/health'), {});
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/D1/);
    });
});
