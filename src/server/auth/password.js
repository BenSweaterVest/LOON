/**
 * PBKDF2-SHA256 password hashing.
 * Stored format: pbkdf2_sha256$<iterations>$<salt b64url>$<hash b64url>
 */

import { badRequest } from '../http.js';
import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from '../crypto.js';

const PREFIX = 'pbkdf2_sha256';
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return new Uint8Array(bits);
}

export function validatePassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        throw badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
    }
}

export async function hashPassword(password, iterations) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(password, salt, iterations);
    return `${PREFIX}$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

function parse(stored) {
    const parts = typeof stored === 'string' ? stored.split('$') : [];
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1) return null;
    return { iterations, salt: base64UrlToBytes(parts[2]), hash: base64UrlToBytes(parts[3]) };
}

export async function verifyPassword(password, stored) {
    const parsed = parse(stored);
    if (!parsed || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false;
    const candidate = await derive(password, parsed.salt, parsed.iterations);
    return timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored, iterations) {
    const parsed = parse(stored);
    return !parsed || parsed.iterations !== iterations;
}

/**
 * A hash that never matches, used to keep login timing uniform for unknown users.
 */
export const DUMMY_HASH = `${PREFIX}$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
