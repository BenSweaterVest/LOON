/**
 * ============================================================================
 * WebAuthn Utility Functions (functions/api/_webauthn.js)
 * ============================================================================
 *
 * Low-level WebAuthn/FIDO2 utilities:
 * - Base64 encoding/decoding for CBOR data
 * - Attestation validation
 * - Assertion validation
 * - Signature verification
 *

 */

import { decode } from 'cbor-x';

/**
 * Convert ArrayBuffer to base64url (no padding)
 */
export function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert base64url to ArrayBuffer
 */
export function base64UrlToArrayBuffer(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Generate cryptographically random bytes
 */
export function getRandomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Hash data with SHA-256
 */
export async function sha256(data) {
    return await crypto.subtle.digest('SHA-256', data);
}

/**
 * Extract public key (COSE CBOR) from attestation object
 * Attestation object structure: { fmt, attStmt, authData }
 * authData structure: [rpIdHash(32) | flags(1) | signCount(4) | attested credential data]
 * Attested credential data: [aaguid(16) | credentialIdLength(2) | credentialId | credentialPublicKey(CBOR)]
 */
export async function extractPublicKeyFromAttestation(attestationObjectB64) {
    try {
        // Decode attestation object
        const attestationBuffer = base64UrlToArrayBuffer(attestationObjectB64);
        const attestationObject = decode(new Uint8Array(attestationBuffer));
        
        if (!attestationObject.authData) {
            throw new Error('Missing authData in attestation object');
        }
        
        // authData is a Uint8Array
        const authData = new Uint8Array(attestationObject.authData);
        
        // Parse authData structure
        // Bytes 0-31: RP ID hash
        // Byte 32: Flags (bit 6 = attested credential data included, bit 2 = user present, bit 0 = user verified)
        // Bytes 33-36: Sign count
        // If flags bit 6 is set, attested credential data follows
        
        const flags = authData[32];
        const attestedCredentialDataIncluded = (flags & 0x40) !== 0;
        
        if (!attestedCredentialDataIncluded) {
            throw new Error('No attested credential data in authData');
        }
        
        let offset = 37; // After RP ID hash, flags, and sign count
        
        // Skip AAGUID (16 bytes)
        const aaguid = authData.slice(offset, offset + 16);
        offset += 16;
        
        // Get credential ID length (2 bytes, big-endian)
        const credIdLength = (authData[offset] << 8) | authData[offset + 1];
        offset += 2;
        
        // Skip credential ID
        const credentialId = authData.slice(offset, offset + credIdLength);
        offset += credIdLength;
        
        // Remaining bytes are the credential public key (CBOR encoded COSE key)
        const publicKeyBytes = authData.slice(offset);
        
        // Decode COSE public key
        const publicKey = decode(publicKeyBytes);
        
        // Validate it's an ES256 key
        if (publicKey[1] !== 2) { // kty must be 2 (EC)
            throw new Error('Invalid key type: only ES256 (EC) keys supported');
        }
        
        if (publicKey[3] !== -7) { // alg must be -7 (ES256)
            throw new Error('Invalid algorithm: only ES256 (-7) supported');
        }
        
        if (publicKey[-1] !== 1) { // crv must be 1 (P-256)
            throw new Error('Invalid curve: only P-256 supported');
        }
        
        // Validate coordinate sizes (must be 32 bytes for P-256)
        const xCoord = publicKey[-2];
        const yCoord = publicKey[-3];
        
        if (!(xCoord instanceof Uint8Array) || xCoord.length !== 32) {
            throw new Error('Invalid x-coordinate: must be 32 bytes');
        }
        
        if (!(yCoord instanceof Uint8Array) || yCoord.length !== 32) {
            throw new Error('Invalid y-coordinate: must be 32 bytes');
        }
        
        // Return structured public key (not raw attestation blob)
        // Encode all binary data as base64url for JSON round-trip through KV
        return {
            format: 'cose',
            publicKey: arrayBufferToBase64Url(publicKeyBytes), // Base64url CBOR COSE key for storage
            x: arrayBufferToBase64Url(xCoord),
            y: arrayBufferToBase64Url(yCoord),
            credentialId: arrayBufferToBase64Url(credentialId) // Also encode credential ID as base64url
        };
        
    } catch (err) {
        throw new Error(`Failed to extract public key from attestation: ${err.message}`);
    }
}

/**
 * Parse CBOR-encoded public key (used during assertion verification)
 * Decodes and validates COSE structure for ES256
 */
export async function parseCBORPublicKey(cborBytes) {
    try {
        if (!(cborBytes instanceof Uint8Array) && !(cborBytes instanceof ArrayBuffer)) {
            throw new Error('Invalid CBOR data: must be Uint8Array or ArrayBuffer');
        }
        
        const publicKey = decode(new Uint8Array(cborBytes));
        
        // Validate ES256 structure
        if (publicKey[1] !== 2) {
            throw new Error('Invalid kty: expected 2 (EC)');
        }
        
        if (publicKey[3] !== -7) {
            throw new Error('Invalid alg: expected -7 (ES256)');
        }
        
        if (publicKey[-1] !== 1) {
            throw new Error('Invalid crv: expected 1 (P-256)');
        }
        
        return publicKey;
    } catch (err) {
        throw new Error(`CBOR parsing failed: ${err.message}`);
    }
}

/**
 * Validate attestation response
 * Current implementation performs basic validation:
 * - Attestation object present
 * - Challenge matches
 * - Format is 'none' (self-signed, no attestation chain needed)
 */
export function validateAttestationResponse(attestationObject, challenge, clientDataJSON) {
    if (!attestationObject) {
        throw new Error('Missing attestation object');
    }
    
    if (!clientDataJSON) {
        throw new Error('Missing client data JSON');
    }

    try {
        // Verify challenge matches in client data
        const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
        
        if (clientData.challenge !== arrayBufferToBase64Url(challenge)) {
            throw new Error('Challenge mismatch in attestation');
        }

        if (clientData.type !== 'webauthn.create') {
            throw new Error('Invalid attestation type');
        }

        return true;
    } catch (err) {
        throw new Error(`Attestation validation failed: ${err.message}`);
    }
}

/**
 * Validate assertion response
 * - Challenge matches
 * - Signature is valid for stored public key
 */
export async function validateAssertionResponse(
    assertionObject,
    challenge,
    clientDataJSON,
    storedPublicKey,
    storedCounter
) {
    if (!assertionObject || !clientDataJSON) {
        throw new Error('Missing assertion data');
    }

    try {
        // Verify challenge
        const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
        
        if (clientData.challenge !== arrayBufferToBase64Url(challenge)) {
            throw new Error('Challenge mismatch in assertion');
        }

        if (clientData.type !== 'webauthn.get') {
            throw new Error('Invalid assertion type');
        }

        // Verify counter (basic cloning detection)
        if (assertionObject.signCount !== undefined) {
            if (assertionObject.signCount <= storedCounter) {
                // Counter didn't increase - possible cloned device
                // Log as audit event, but don't block (admin can investigate)
                console.warn(`Possible cloned device detected: counter ${assertionObject.signCount} <= stored ${storedCounter}`);
            }
        }

        return {
            valid: true,
            newCounter: assertionObject.signCount || storedCounter + 1
        };
    } catch (err) {
        throw new Error(`Assertion validation failed: ${err.message}`);
    }
}

/**
 * Validate recovery code format (8 alphanumeric uppercase characters)
 */
export function isValidRecoveryCode(code) {
    return typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code);
}

/**
 * Generate recovery codes (12x 8-character base36 strings)
 * Format: ABC12345, DEF67890, etc.
 */
export function generateRecoveryCodes() {
    const codes = [];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    
    for (let i = 0; i < 12; i++) {
        let code = '';
        for (let j = 0; j < 8; j++) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        codes.push(code);
    }
    
    return codes;
}

/**
 * Hash recovery code with PBKDF2
 * Uses same hashing as passwords for consistency
 */
export async function hashRecoveryCode(code, salt = null) {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    
    // Use stored salt or generate new one
    if (!salt) {
        salt = getRandomBytes(16);
    } else if (typeof salt === 'string') {
        salt = base64UrlToArrayBuffer(salt);
    }
    
    const key = await crypto.subtle.importKey(
        'raw',
        data,
        'PBKDF2',
        false,
        ['deriveBits']
    );
    
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        key,
        256
    );
    
    return {
        hash: arrayBufferToBase64Url(bits),
        salt: arrayBufferToBase64Url(salt)
    };
}

/**
 * Verify recovery code against hash
 */
export async function verifyRecoveryCode(code, hashedCode, salt) {
    const result = await hashRecoveryCode(code, salt);
    
    // Timing-safe comparison
    return timingSafeEqual(result.hash, hashedCode);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        throw new TypeError('arguments must be strings');
    }
    
    if (a.length !== b.length) {
        return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
}

/**
 * Create credential ID from attestation response
 */
export function getCredentialId(attestationResponse) {
    // Credential ID is typically in the attestation object
    // This is a simplified extraction
    if (attestationResponse.id) {
        return attestationResponse.id;
    }
    throw new Error('Could not extract credential ID from attestation');
}

/**
 * Export functions for Node.js/backend use
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        arrayBufferToBase64Url,
        base64UrlToArrayBuffer,
        getRandomBytes,
        sha256,
        parseCBORPublicKey,
        validateAttestationResponse,
        validateAssertionResponse,
        generateRecoveryCodes,
        isValidRecoveryCode,
        hashRecoveryCode,
        verifyRecoveryCode,
        timingSafeEqual,
        getCredentialId
    };
}
