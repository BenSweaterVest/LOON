import { describe, it, expect } from 'vitest';
import { Client, ORIGIN, createEnv, seedUser, signedIn } from './helpers.js';
import { SoftAuthenticator } from './soft-authenticator.js';
import { hashPassword, needsRehash, verifyPassword } from '../src/server/auth/password.js';

describe('password hashing', () => {
    it('verifies, rejects, and flags rehash on iteration change', async () => {
        const hash = await hashPassword('a long passphrase', 1000);
        expect(await verifyPassword('a long passphrase', hash)).toBe(true);
        expect(await verifyPassword('wrong passphrase', hash)).toBe(false);
        expect(await verifyPassword('x', 'garbage')).toBe(false);
        expect(needsRehash(hash, 1000)).toBe(false);
        expect(needsRehash(hash, 2000)).toBe(true);
    });
});

describe('setup', () => {
    it('creates the first admin once, with the setup token', async () => {
        const env = await createEnv();
        const client = new Client(env);
        expect((await client.get('/api/setup')).data).toEqual({ needsSetup: true, setupTokenConfigured: true });

        const bad = await client.post('/api/setup', { setupToken: 'nope', username: 'root', password: 'a long passphrase' });
        expect(bad.status).toBe(403);

        const ok = await client.post('/api/setup', { setupToken: env.SETUP_TOKEN, username: 'Root', password: 'a long passphrase' });
        expect(ok.status).toBe(200);
        expect(ok.data.user).toMatchObject({ username: 'root', role: 'admin' });
        expect((await client.get('/api/auth/me')).data.user.username).toBe('root');

        const again = await new Client(env).post('/api/setup', { setupToken: env.SETUP_TOKEN, username: 'other', password: 'a long passphrase' });
        expect(again.status).toBe(409);
        expect((await client.get('/api/setup')).data.needsSetup).toBe(false);
    });

    it('explains a missing setup token', async () => {
        const env = await createEnv({ SETUP_TOKEN: '' });
        const res = await new Client(env).post('/api/setup', { setupToken: 'x', username: 'root', password: 'a long passphrase' });
        expect(res.status).toBe(503);
        expect(res.data.error).toMatch(/SETUP_TOKEN/);
    });

    it('enforces password policy', async () => {
        const env = await createEnv();
        const res = await new Client(env).post('/api/setup', { setupToken: env.SETUP_TOKEN, username: 'root', password: 'short' });
        expect(res.status).toBe(400);
    });
});

describe('login and sessions', () => {
    it('logs in with a secure cookie and logs out', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice', 'editor');
        const client = new Client(env);
        const res = await client.login('alice');
        const cookie = res.headers.getSetCookie()[0];
        expect(cookie).toMatch(/^__Host-loon_session=/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);
        expect(cookie).toMatch(/Secure/);

        expect((await client.get('/api/auth/me')).data.user.role).toBe('editor');
        await client.post('/api/auth/logout');
        expect((await client.get('/api/auth/me')).data.user).toBeNull();
    });

    it('stores only a hash of the session token', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice');
        const client = new Client(env);
        await client.login('alice');
        const token = client.cookies.get('__Host-loon_session');
        const row = await env.DB.prepare('SELECT id FROM sessions').first();
        expect(row.id).not.toBe(token);
        expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uses a plain cookie name in development', async () => {
        const env = await createEnv({ LOON_ENV: 'development' });
        await seedUser(env, 'alice');
        const res = await new Client(env).login('alice');
        expect(res.headers.getSetCookie()[0]).toMatch(/^loon_session=.*(?<!Secure)$/);
    });

    it('gives the same error for unknown users, wrong passwords and disabled users', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice');
        await seedUser(env, 'bob', 'editor', 'correct horse battery', { disabled: true });
        const a = await new Client(env, { ip: '1.1.1.1' }).post('/api/auth/login', { username: 'nobody', password: 'whatever pass' });
        const b = await new Client(env, { ip: '1.1.1.2' }).post('/api/auth/login', { username: 'alice', password: 'wrong password' });
        const c = await new Client(env, { ip: '1.1.1.3' }).post('/api/auth/login', { username: 'bob', password: 'correct horse battery' });
        expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
        expect(new Set([a.data.error, b.data.error, c.data.error]).size).toBe(1);
    });

    it('rate limits login attempts per IP', async () => {
        const env = await createEnv();
        const client = new Client(env);
        const statuses = [];
        for (let i = 0; i < 6; i++) {
            statuses.push((await client.post('/api/auth/login', { username: 'x', password: 'y' })).status);
        }
        expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
        expect(statuses[5]).toBe(429);
    });

    it('rejects cross-origin state-changing requests', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice');
        const res = await new Client(env).request('POST', '/api/auth/login', {
            body: { username: 'alice', password: 'correct horse battery' },
            origin: 'https://evil.example'
        });
        expect(res.status).toBe(403);
    });

    it('rehashes passwords when the iteration count changes', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice');
        await new Client(env).login('alice');
        const before = (await env.DB.prepare('SELECT password_hash FROM users').first()).password_hash;
        env.PBKDF2_ITERATIONS = '2000';
        await new Client(env, { ip: '9.9.9.9' }).login('alice');
        const after = (await env.DB.prepare('SELECT password_hash FROM users').first()).password_hash;
        expect(before).toMatch(/\$1000\$/);
        expect(after).toMatch(/\$2000\$/);
    });

    it('requires a password change before anything else when flagged', async () => {
        const env = await createEnv();
        const client = await signedIn(env, 'temp', 'admin', { mustChangePassword: true });
        expect((await client.get('/api/users')).data.details.code).toBe('password_change_required');
        const change = await client.post('/api/auth/password', { currentPassword: 'correct horse battery', newPassword: 'a brand new passphrase' });
        expect(change.status).toBe(200);
        expect((await client.get('/api/users')).status).toBe(200);
    });

    it('ends other sessions on password change', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice');
        const one = new Client(env, { ip: '1.0.0.1' });
        const two = new Client(env, { ip: '1.0.0.2' });
        await one.login('alice');
        await two.login('alice');
        await one.post('/api/auth/password', { currentPassword: 'correct horse battery', newPassword: 'another long passphrase' });
        expect((await one.get('/api/auth/me')).data.user).not.toBeNull();
        expect((await two.get('/api/auth/me')).data.user).toBeNull();
    });

    it('lists and revokes sessions', async () => {
        const env = await createEnv();
        await seedUser(env, 'alice', 'editor');
        const one = new Client(env, { ip: '1.0.0.1' });
        const two = new Client(env, { ip: '1.0.0.2' });
        await one.login('alice');
        await two.login('alice');
        const list = (await one.get('/api/sessions')).data.sessions;
        expect(list).toHaveLength(2);
        const other = list.find((s) => !s.current);
        expect((await one.delete(`/api/sessions/${other.id}`)).status).toBe(200);
        expect((await two.get('/api/auth/me')).data.user).toBeNull();
        expect((await one.get('/api/sessions?all=1')).status).toBe(403);
    });
});

describe('user administration', () => {
    it('is admin only', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        expect((await editor.get('/api/users')).status).toBe(403);
        expect((await new Client(env).get('/api/users')).status).toBe(401);
    });

    it('creates a user with a temporary password that must be changed', async () => {
        const env = await createEnv();
        const admin = await signedIn(env, 'root');
        const created = await admin.post('/api/users', { username: 'carol', role: 'contributor' });
        expect(created.status).toBe(200);
        expect(created.data.user.mustChangePassword).toBe(true);
        const carol = new Client(env, { ip: '2.2.2.2' });
        await carol.login('carol', created.data.temporaryPassword);
        expect((await carol.get('/api/sessions')).status).toBe(403);
        expect((await admin.post('/api/users', { username: 'carol', role: 'editor' })).status).toBe(409);
    });

    it('protects the last admin and the current user', async () => {
        const env = await createEnv();
        const admin = await signedIn(env, 'root');
        expect((await admin.patch('/api/users/root', { role: 'editor' })).status).toBe(409);
        expect((await admin.delete('/api/users/root')).status).toBe(409);
        await seedUser(env, 'second', 'admin');
        expect((await admin.patch('/api/users/second', { disabled: true })).status).toBe(200);
        expect((await admin.delete('/api/users/second')).status).toBe(200);
    });

    it('applies role changes and disabling immediately', async () => {
        const env = await createEnv();
        const admin = await signedIn(env, 'root');
        await seedUser(env, 'dave', 'admin');
        const dave = new Client(env, { ip: '3.3.3.3' });
        await dave.login('dave');
        await admin.patch('/api/users/dave', { role: 'editor' });
        expect((await dave.get('/api/users')).status).toBe(403);
        await admin.patch('/api/users/dave', { disabled: true });
        expect((await dave.get('/api/auth/me')).data.user).toBeNull();
    });

    it('resets passwords and ends sessions', async () => {
        const env = await createEnv();
        const admin = await signedIn(env, 'root');
        await seedUser(env, 'erin', 'editor');
        const erin = new Client(env, { ip: '4.4.4.4' });
        await erin.login('erin');
        const reset = await admin.post('/api/users/erin/reset-password');
        expect(reset.data.temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
        expect((await erin.get('/api/auth/me')).data.user).toBeNull();
    });

    it('records an audit trail', async () => {
        const env = await createEnv();
        const admin = await signedIn(env, 'root');
        await admin.post('/api/users', { username: 'frank', role: 'editor' });
        const { entries } = (await admin.get('/api/audit?limit=10')).data;
        expect(entries.map((e) => e.action)).toEqual(['user.create', 'auth.login']);
        expect(entries[0]).toMatchObject({ actor: 'root', target: 'user:frank', details: { role: 'editor' } });
    });
});

describe('passkeys', () => {
    async function registerPasskey(client) {
        const authenticator = await SoftAuthenticator.create();
        const { challengeId, options } = (await client.post('/api/passkeys/register/options')).data;
        expect(options.rp.id).toBe('loon.test');
        const response = await authenticator.register(options, ORIGIN);
        const verify = await client.post('/api/passkeys/register/verify', { challengeId, response, name: 'Laptop' });
        return { authenticator, verify };
    }

    it('registers, signs in, and issues recovery codes once', async () => {
        const env = await createEnv();
        const client = await signedIn(env, 'alice', 'editor');
        const { authenticator, verify } = await registerPasskey(client);
        expect(verify.status).toBe(200);
        expect(verify.data.passkey.name).toBe('Laptop');
        expect(verify.data.recoveryCodes).toHaveLength(10);

        const second = await registerPasskey(client);
        expect(second.verify.data.recoveryCodes).toBeUndefined();

        const fresh = new Client(env, { ip: '5.5.5.5' });
        const { challengeId, options } = (await fresh.post('/api/passkeys/login/options', {})).data;
        const assertion = await authenticator.authenticate(options, ORIGIN);
        const login = await fresh.post('/api/passkeys/login/verify', { challengeId, response: assertion });
        expect(login.status).toBe(200);
        expect(login.data.user.username).toBe('alice');
        expect((await fresh.get('/api/auth/me')).data.session.method).toBe('passkey');

        const replay = await fresh.post('/api/passkeys/login/verify', { challengeId, response: assertion });
        expect(replay.status).toBe(400);
    });

    it('rejects an assertion for the wrong origin', async () => {
        const env = await createEnv();
        const client = await signedIn(env, 'alice');
        const { authenticator } = await registerPasskey(client);
        const fresh = new Client(env, { ip: '6.6.6.6' });
        const { challengeId, options } = (await fresh.post('/api/passkeys/login/options', { username: 'alice' })).data;
        expect(options.allowCredentials).toHaveLength(1);
        const assertion = await authenticator.authenticate(options, 'https://phish.example');
        expect((await fresh.post('/api/passkeys/login/verify', { challengeId, response: assertion })).status).toBe(401);
    });

    it('lists, renames and deletes own passkeys only', async () => {
        const env = await createEnv();
        const alice = await signedIn(env, 'alice');
        const { authenticator } = await registerPasskey(alice);
        const bob = await signedIn(env, 'bob', 'editor');
        expect((await bob.patch(`/api/passkeys/${authenticator.id}`, { name: 'Mine' })).status).toBe(404);
        expect((await alice.patch(`/api/passkeys/${authenticator.id}`, { name: 'Phone' })).data.passkey.name).toBe('Phone');
        expect((await alice.get('/api/passkeys')).data.passkeys).toHaveLength(1);
        expect((await alice.delete(`/api/passkeys/${authenticator.id}`)).status).toBe(200);
        expect((await alice.get('/api/passkeys')).data.passkeys).toHaveLength(0);
    });

    it('signs in with a recovery code once and forces a password change', async () => {
        const env = await createEnv();
        const alice = await signedIn(env, 'alice', 'editor');
        const { recoveryCodes } = (await alice.post('/api/passkeys/recovery-codes')).data;
        const fresh = new Client(env, { ip: '7.7.7.7' });
        const res = await fresh.post('/api/auth/recovery', { username: 'alice', code: recoveryCodes[0].toLowerCase() });
        expect(res.status).toBe(200);
        expect(res.data.user.mustChangePassword).toBe(true);
        const change = await fresh.post('/api/auth/password', { newPassword: 'recovered passphrase' });
        expect(change.status).toBe(200);
        const reuse = await new Client(env, { ip: '7.7.7.8' }).post('/api/auth/recovery', { username: 'alice', code: recoveryCodes[0] });
        expect(reuse.status).toBe(401);
    });
});
