/**
 * A software WebAuthn authenticator (ES256, "none" attestation) for tests.
 */

import { bytesToBase64Url } from '../src/server/crypto.js';

function head(major, length) {
    if (length < 24) return [(major << 5) | length];
    if (length < 256) return [(major << 5) | 24, length];
    if (length < 65536) return [(major << 5) | 25, length >> 8, length & 0xff];
    throw new Error('too long');
}

function cbor(value) {
    if (typeof value === 'number') {
        return value >= 0 ? head(0, value) : head(1, -1 - value);
    }
    if (typeof value === 'string') {
        const bytes = new TextEncoder().encode(value);
        return [...head(3, bytes.length), ...bytes];
    }
    if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
    if (value instanceof Map) {
        const out = head(5, value.size);
        for (const [k, v] of value) out.push(...cbor(k), ...cbor(v));
        return out;
    }
    throw new Error('unsupported');
}

const concat = (...parts) => new Uint8Array(parts.flatMap((p) => [...p]));
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function derSignature(raw) {
    const encodeInt = (bytes) => {
        let i = 0;
        while (i < bytes.length - 1 && bytes[i] === 0) i++;
        let out = [...bytes.slice(i)];
        if (out[0] & 0x80) out = [0, ...out];
        return [0x02, out.length, ...out];
    };
    const r = encodeInt(raw.slice(0, 32));
    const s = encodeInt(raw.slice(32));
    return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

export class SoftAuthenticator {
    static async create() {
        const auth = new SoftAuthenticator();
        auth.keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        auth.credentialId = crypto.getRandomValues(new Uint8Array(16));
        auth.counter = 0;
        return auth;
    }

    get id() {
        return bytesToBase64Url(this.credentialId);
    }

    async register(options, origin) {
        const jwk = await crypto.subtle.exportKey('jwk', this.keys.publicKey);
        const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
        const cose = new Uint8Array(cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, b64(jwk.x)], [-3, b64(jwk.y)]])));
        const rpIdHash = await sha256(new TextEncoder().encode(options.rp.id));
        const authData = concat(
            rpIdHash, [0x45], u32(this.counter), new Uint8Array(16),
            [this.credentialId.length >> 8, this.credentialId.length & 0xff], this.credentialId, cose
        );
        const attestationObject = new Uint8Array(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
        const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key',
            response: {
                clientDataJSON: bytesToBase64Url(clientData),
                attestationObject: bytesToBase64Url(attestationObject),
                transports: ['internal']
            },
            clientExtensionResults: {}
        };
    }

    async authenticate(options, origin) {
        this.counter += 1;
        const rpIdHash = await sha256(new TextEncoder().encode(options.rpId));
        const authData = concat(rpIdHash, [0x05], u32(this.counter));
        const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
        const signed = concat(authData, await sha256(clientData));
        const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed));
        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key',
            response: {
                clientDataJSON: bytesToBase64Url(clientData),
                authenticatorData: bytesToBase64Url(authData),
                signature: bytesToBase64Url(derSignature(raw))
            },
            clientExtensionResults: {}
        };
    }
}
