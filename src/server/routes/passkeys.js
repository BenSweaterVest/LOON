/**
 * Passkeys (WebAuthn) and recovery codes.
 *
 *   POST   /api/passkeys/register/options   (signed in)  -> { challengeId, options }
 *   POST   /api/passkeys/register/verify    (signed in)  { challengeId, response, name? } -> { passkey, recoveryCodes? }
 *   POST   /api/passkeys/login/options      { username? } -> { challengeId, options }
 *   POST   /api/passkeys/login/verify       { challengeId, response } -> { user }
 *   GET    /api/passkeys                    (signed in)
 *   PATCH  /api/passkeys/:id                (signed in)  { name }
 *   DELETE /api/passkeys/:id                (signed in)
 *   POST   /api/passkeys/recovery-codes     (signed in)  -> { recoveryCodes }  (replaces old codes)
 *   POST   /api/auth/recovery               { username, code } -> { user }   (forces a password change)
 *
 * The relying party ID and origin default to the request's own host, which is
 * correct for *.pages.dev and custom domains alike; RP_ID / RP_ORIGIN override.
 */

import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from '@simplewebauthn/server';
import { all, first, run } from '../db/index.js';
import { badRequest, notFound, readJson, unauthorized } from '../http.js';
import { base64UrlToBytes, bytesToBase64Url, randomToken, sha256Hex } from '../crypto.js';
import { createSession, toUser } from '../auth/sessions.js';
import { enforceRateLimit } from '../ratelimit.js';
import { audit } from '../audit.js';
import { optionalString, USERNAME_PATTERN } from '../validate.js';
import { getUser } from '../users.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIGNED_IN = { auth: 'contributor' };

function relyingParty(ctx) {
    return {
        rpID: ctx.config.rpId || ctx.url.hostname,
        origin: ctx.config.rpOrigin || ctx.url.origin,
        rpName: ctx.config.rpName
    };
}

async function storeChallenge(ctx, kind, challenge, username = null) {
    const id = randomToken(16);
    const now = Date.now();
    await ctx.db.batch([
        ctx.db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now),
        ctx.db.prepare('INSERT INTO challenges (id, kind, username, challenge, expires_at) VALUES (?, ?, ?, ?, ?)')
            .bind(id, kind, username, challenge, now + CHALLENGE_TTL_MS)
    ]);
    return id;
}

/**
 * Fetch and delete a challenge in one step so it can only be used once.
 */
async function consumeChallenge(ctx, id, kind) {
    if (typeof id !== 'string' || !id) throw badRequest('challengeId is required');
    const row = await first(
        ctx.db,
        'DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING challenge, username, expires_at',
        id, kind
    );
    if (!row || row.expires_at < Date.now()) throw badRequest('Passkey request expired. Try again.');
    return row;
}

function presentPasskey(row) {
    return {
        id: row.id,
        name: row.name,
        deviceType: row.device_type,
        backedUp: !!row.backed_up,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
    };
}

function normalizeRecoveryCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

async function replaceRecoveryCodes(db, username) {
    const now = Date.now();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashes = await Promise.all(codes.map((code) => sha256Hex(normalizeRecoveryCode(code))));
    await db.batch([
        db.prepare('DELETE FROM recovery_codes WHERE username = ?').bind(username),
        ...hashes.map((hash) => db.prepare('INSERT INTO recovery_codes (username, code_hash, created_at) VALUES (?, ?, ?)').bind(username, hash, now))
    ]);
    return codes;
}

async function requireOwnPasskey(ctx) {
    const row = await first(ctx.db, 'SELECT * FROM passkeys WHERE id = ? AND username = ?', ctx.params.id, ctx.user.username);
    if (!row) throw notFound('Passkey not found');
    return row;
}

export function register(router) {
    router.post('/api/passkeys/register/options', async (ctx) => {
        await enforceRateLimit(ctx, 'passkey', ctx.user.username);
        const rp = relyingParty(ctx);
        const existing = await all(ctx.db, 'SELECT id, transports FROM passkeys WHERE username = ?', ctx.user.username);
        const options = await generateRegistrationOptions({
            rpName: rp.rpName,
            rpID: rp.rpID,
            userName: ctx.user.username,
            userDisplayName: ctx.user.displayName,
            userID: new TextEncoder().encode(ctx.user.username),
            attestationType: 'none',
            excludeCredentials: existing.map((p) => ({ id: p.id, transports: JSON.parse(p.transports) })),
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
        });
        const challengeId = await storeChallenge(ctx, 'register', options.challenge, ctx.user.username);
        return { challengeId, options };
    }, SIGNED_IN);

    router.post('/api/passkeys/register/verify', async (ctx) => {
        const body = await readJson(ctx.request, { maxBytes: 64 * 1024 });
        const challenge = await consumeChallenge(ctx, body.challengeId, 'register');
        if (challenge.username !== ctx.user.username) throw badRequest('Passkey request does not match this account');
        const rp = relyingParty(ctx);

        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response: body.response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: rp.origin,
                expectedRPID: rp.rpID,
                requireUserVerification: false
            });
        } catch (err) {
            throw badRequest(`Passkey could not be verified: ${err.message}`);
        }
        if (!verification.verified) throw badRequest('Passkey could not be verified');

        const info = verification.registrationInfo;
        const { credential } = info;
        if (await first(ctx.db, 'SELECT 1 FROM passkeys WHERE id = ?', credential.id)) {
            throw badRequest('This passkey is already registered');
        }
        const name = optionalString(body.name, 'Name', { max: 60 }) || 'Passkey';
        const now = Date.now();
        await run(
            ctx.db,
            `INSERT INTO passkeys (id, username, public_key, counter, transports, device_type, backed_up, name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            credential.id, ctx.user.username, bytesToBase64Url(credential.publicKey), credential.counter,
            JSON.stringify(credential.transports || []), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, name, now
        );
        await audit(ctx, 'passkey.register', `user:${ctx.user.username}`, { name });

        const hasCodes = await first(ctx.db, 'SELECT 1 FROM recovery_codes WHERE username = ? AND used_at IS NULL LIMIT 1', ctx.user.username);
        const passkey = presentPasskey(await first(ctx.db, 'SELECT * FROM passkeys WHERE id = ?', credential.id));
        if (hasCodes) return { passkey };
        return { passkey, recoveryCodes: await replaceRecoveryCodes(ctx.db, ctx.user.username) };
    }, SIGNED_IN);

    router.post('/api/passkeys/login/options', async (ctx) => {
        await enforceRateLimit(ctx, 'passkey');
        const body = await readJson(ctx.request, { maxBytes: 4096 });
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        let allowCredentials = [];
        if (username && USERNAME_PATTERN.test(username)) {
            const rows = await all(ctx.db, 'SELECT id, transports FROM passkeys WHERE username = ?', username);
            allowCredentials = rows.map((p) => ({ id: p.id, transports: JSON.parse(p.transports) }));
        }
        const options = await generateAuthenticationOptions({
            rpID: relyingParty(ctx).rpID,
            allowCredentials,
            userVerification: 'preferred'
        });
        const challengeId = await storeChallenge(ctx, 'login', options.challenge);
        return { challengeId, options };
    });

    router.post('/api/passkeys/login/verify', async (ctx) => {
        await enforceRateLimit(ctx, 'passkey');
        const body = await readJson(ctx.request, { maxBytes: 64 * 1024 });
        const challenge = await consumeChallenge(ctx, body.challengeId, 'login');
        const credentialId = body.response?.id;
        if (typeof credentialId !== 'string') throw badRequest('Passkey response is missing');

        const passkey = await first(
            ctx.db,
            `SELECT p.*, u.disabled FROM passkeys p JOIN users u ON u.username = p.username WHERE p.id = ?`,
            credentialId
        );
        if (!passkey || passkey.disabled) throw unauthorized('Passkey not recognized');
        const rp = relyingParty(ctx);

        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response: body.response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: rp.origin,
                expectedRPID: rp.rpID,
                requireUserVerification: false,
                credential: {
                    id: passkey.id,
                    publicKey: base64UrlToBytes(passkey.public_key),
                    counter: passkey.counter,
                    transports: JSON.parse(passkey.transports)
                }
            });
        } catch (err) {
            throw unauthorized(`Passkey could not be verified: ${err.message}`);
        }
        if (!verification.verified) throw unauthorized('Passkey could not be verified');

        const now = Date.now();
        await ctx.db.batch([
            ctx.db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
                .bind(verification.authenticationInfo.newCounter, now, passkey.id),
            ctx.db.prepare('UPDATE users SET last_login_at = ? WHERE username = ?').bind(now, passkey.username)
        ]);
        await createSession(ctx, passkey.username, 'passkey');
        ctx.user = toUser(await getUser(ctx.db, passkey.username));
        await audit(ctx, 'auth.login', `user:${passkey.username}`, { method: 'passkey', passkey: passkey.name });
        return { user: ctx.user };
    });

    router.get('/api/passkeys', async (ctx) => {
        const rows = await all(ctx.db, 'SELECT * FROM passkeys WHERE username = ? ORDER BY created_at', ctx.user.username);
        return { passkeys: rows.map(presentPasskey) };
    }, SIGNED_IN);

    router.patch('/api/passkeys/:id', async (ctx) => {
        const row = await requireOwnPasskey(ctx);
        const body = await readJson(ctx.request, { maxBytes: 4096 });
        const name = optionalString(body.name, 'Name', { max: 60 });
        if (!name) throw badRequest('Name is required');
        await run(ctx.db, 'UPDATE passkeys SET name = ? WHERE id = ?', name, row.id);
        return { passkey: presentPasskey({ ...row, name }) };
    }, SIGNED_IN);

    router.delete('/api/passkeys/:id', async (ctx) => {
        const row = await requireOwnPasskey(ctx);
        await run(ctx.db, 'DELETE FROM passkeys WHERE id = ?', row.id);
        await audit(ctx, 'passkey.delete', `user:${ctx.user.username}`, { name: row.name });
        return { ok: true };
    }, SIGNED_IN);

    router.post('/api/passkeys/recovery-codes', async (ctx) => {
        const codes = await replaceRecoveryCodes(ctx.db, ctx.user.username);
        await audit(ctx, 'recovery_codes.regenerate', `user:${ctx.user.username}`);
        return { recoveryCodes: codes };
    }, SIGNED_IN);

    router.post('/api/auth/recovery', async (ctx) => {
        await enforceRateLimit(ctx, 'login');
        const body = await readJson(ctx.request, { maxBytes: 4096 });
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const code = normalizeRecoveryCode(body.code);
        if (!USERNAME_PATTERN.test(username) || code.length !== 10) throw unauthorized('Recovery code not accepted');
        await enforceRateLimit(ctx, 'login', `user:${username}`);

        const hash = await sha256Hex(code);
        const used = await ctx.db.prepare(
            `UPDATE recovery_codes SET used_at = ?
             WHERE username = ? AND code_hash = ? AND used_at IS NULL
               AND username IN (SELECT username FROM users WHERE disabled = 0)`
        ).bind(Date.now(), username, hash).run();
        if (!used.meta.changes) {
            await audit(ctx, 'auth.recovery_failed', `user:${username}`);
            throw unauthorized('Recovery code not accepted');
        }

        await run(ctx.db, 'UPDATE users SET must_change_password = 1, last_login_at = ? WHERE username = ?', Date.now(), username);
        await createSession(ctx, username, 'recovery');
        ctx.user = toUser(await getUser(ctx.db, username));
        await audit(ctx, 'auth.login', `user:${username}`, { method: 'recovery_code' });
        return { user: ctx.user };
    });
}
