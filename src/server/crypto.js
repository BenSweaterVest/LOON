/**
 * Small Web Crypto helpers used across auth code.
 */

export function bytesToBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function randomToken(byteLength = 32) {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(input) {
    const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
    const left = typeof a === 'string' ? new TextEncoder().encode(a) : a;
    const right = typeof b === 'string' ? new TextEncoder().encode(b) : b;
    let diff = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return diff === 0;
}
