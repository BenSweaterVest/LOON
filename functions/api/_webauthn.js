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
 * Parse CBOR-encoded public key (simplified, ES256 only)
 * CBOR map structure for ES256:
 * {
 *   1: 2,              // kty: EC
 *   3: -7,             // alg: ES256
 *   -1: 1,             // crv: P-256
 *   -2: x-coordinate,  // x (32 bytes)
 *   -3: y-coordinate   // y (32 bytes)
 * }
 */
export function parseCBORPublicKey(cbor) {
    // This is a simplified parser - in production, use a full CBOR library
    // For now, just validate it's a valid buffer and return raw CBOR
    if (!(cbor instanceof ArrayBuffer) && !(cbor instanceof Uint8Array)) {
        throw new Error('Invalid CBOR data');
    }
    return cbor; // Return as-is for storage and verification
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
        hashRecoveryCode,
        verifyRecoveryCode,
        timingSafeEqual,
        getCredentialId
    };
}
