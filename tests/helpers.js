/**
 * Test harness: a real D1 (via Miniflare) and a cookie-aware client that
 * drives the actual request pipeline in src/server/app.js.
 */

import { Miniflare } from 'miniflare';
import { afterAll } from 'vitest';
import { handle } from '../src/server/app.js';
import { migrate } from '../src/server/db/index.js';
import { hashPassword } from '../src/server/auth/password.js';

export const ORIGIN = 'https://loon.test';
export const TEST_ITERATIONS = 1000;

const instances = [];
afterAll(async () => {
    await Promise.all(instances.map((mf) => mf.dispose()));
});

export async function createEnv(overrides = {}) {
    const mf = new Miniflare({
        modules: true,
        script: 'export default { fetch() { return new Response(null); } }',
        d1Databases: ['DB']
    });
    instances.push(mf);
    const DB = await mf.getD1Database('DB');
    await migrate(DB);
    return {
        DB,
        PBKDF2_ITERATIONS: String(TEST_ITERATIONS),
        SETUP_TOKEN: 'setup-token-for-tests',
        ...overrides
    };
}

export async function seedUser(env, username, role = 'admin', password = 'correct horse battery', extra = {}) {
    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO users (username, display_name, role, password_hash, created_at, updated_at, must_change_password, disabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        username, extra.displayName || '', role,
        await hashPassword(password, TEST_ITERATIONS), now, now,
        extra.mustChangePassword ? 1 : 0, extra.disabled ? 1 : 0
    ).run();
    return { username, password };
}

export class Client {
    constructor(env, { ip = '203.0.113.10' } = {}) {
        this.env = env;
        this.ip = ip;
        this.cookies = new Map();
        this.waits = [];
    }

    async request(method, path, { body, headers = {}, origin = ORIGIN, raw } = {}) {
        const init = { method, headers: { 'CF-Connecting-IP': this.ip, ...headers } };
        if (origin && method !== 'GET') init.headers.Origin = origin;
        if (this.cookies.size) {
            init.headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        }
        if (raw !== undefined) {
            init.body = raw;
        } else if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await handle(new Request(`${ORIGIN}${path}`, init), this.env, {
            waitUntil: (p) => this.waits.push(p)
        });
        await Promise.allSettled(this.waits.splice(0));
        for (const cookie of res.headers.getSetCookie()) {
            const [pair, ...attrs] = cookie.split(';');
            const [name, value] = pair.split('=');
            const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
            if (maxAge && maxAge.trim().slice(8) === '0') this.cookies.delete(name.trim());
            else this.cookies.set(name.trim(), value.trim());
        }
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { status: res.status, data, headers: res.headers };
    }

    get(path, opts) { return this.request('GET', path, opts); }
    post(path, body, opts) { return this.request('POST', path, { ...opts, body }); }
    put(path, body, opts) { return this.request('PUT', path, { ...opts, body }); }
    patch(path, body, opts) { return this.request('PATCH', path, { ...opts, body }); }
    delete(path, body, opts) { return this.request('DELETE', path, { ...opts, body }); }

    async login(username, password = 'correct horse battery') {
        const res = await this.post('/api/auth/login', { username, password });
        if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.data)}`);
        return res;
    }
}

export async function signedIn(env, username, role = 'admin', extra = {}) {
    await seedUser(env, username, role, undefined, extra);
    const client = new Client(env);
    await client.login(username);
    return client;
}
