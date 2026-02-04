/**
 * ============================================================================
 * Passkey Schema & Utilities (functions/api/_passkeys-schema.js)
 * ============================================================================
 *
 * KV schema definitions and utility functions for passkey management:
 * - Passkey credential storage format
 * - Recovery code storage format
 * - Challenge storage format
 * - Validation functions
 *

 */

import {
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
    timingSafeEqual,
    base64UrlToArrayBuffer
} from './_webauthn.js';

/**
 * Create new passkey credential entry for KV storage
 */
export function createPasskeyCredential(credentialId, publicKey, transports = ['internal']) {
    return {
        id: credentialId,
        credentialId: credentialId,
        publicKey: publicKey, // base64url CBOR-encoded
        algorithm: -7, // ES256 (IANA COSE algorithm)
        transports: transports || ['internal'],
        created: Date.now(),
        lastUsed: null,
        name: 'Unnamed Device',
        counter: 0,
        aaguid: '00000000-0000-0000-0000-000000000000' // No specific device required
    };
}

/**
 * Create recovery codes entry for KV storage
 * Returns: { codes: [...hashed codes], salt: "...", created: timestamp, used: [] }
 */
export async function createRecoveryCodesEntry(plainCodes = null) {
    const codes = plainCodes || generateRecoveryCodes();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = btoa(String.fromCharCode(...salt)).replace(/\+/g, '-').replace(/\//g, '_');
    
    const hashedCodes = [];
    for (const code of codes) {
        const { hash } = await hashRecoveryCode(code, salt);
        hashedCodes.push(hash);
    }
    
    return {
        codes: hashedCodes,
        salt: saltB64,
        created: Date.now(),
        used: [], // indices of used codes
        plainCodes: codes // Return plain codes for user backup (not stored in KV)
    };
}

/**
 * Validate credential ID format
 */
export function isValidCredentialId(credentialId) {
    // Credential IDs are typically base64url-encoded and 64-256 bytes
    if (typeof credentialId !== 'string' || credentialId.length < 20 || credentialId.length > 350) {
        return false;
    }
    
    // Check if it's valid base64url
    const base64urlRegex = /^[A-Za-z0-9_-]*$/;
    return base64urlRegex.test(credentialId);
}

/**
 * Validate recovery code format
 */
export function isValidRecoveryCode(code) {
    // Recovery codes: 8 alphanumeric characters
    const recoveryCodeRegex = /^[A-Z0-9]{8}$/;
    return recoveryCodeRegex.test(code);
}

/**
 * Get KV key for passkey credential
 */
export function getPasskeyKey(username, credentialId) {
    if (!username || !credentialId) {
        throw new Error('Username and credential ID required');
    }
    return `user:${username}:passkey:${credentialId}`;
}

/**
 * Get KV key for recovery codes
 */
export function getRecoveryCodesKey(username) {
    if (!username) {
        throw new Error('Username required');
    }
    return `user:${username}:recovery`;
}

/**
 * Get KV key for registration challenge
 */
export function getRegistrationChallengeKey(token) {
    return `challenge:registration:${token}`;
}

/**
 * Get KV key for authentication challenge
 */
export function getAuthChallengeKey(token) {
    return `challenge:auth:${token}`;
}

/**
 * Get KV key for recovery auth token
 */
export function getRecoveryAuthKey(token) {
    return `recovery:auth:${token}`;
}

/**
 * List all passkeys for a user
 */
export async function listUserPasskeys(db, username) {
    // Since KV doesn't support pattern matching, we'd need to maintain
    // a separate index. For now, return from cache or maintenance endpoint.
    // This is a limitation of Cloudflare KV.
    const indexKey = `user:${username}:passkey:index`;
    const stored = await db.get(indexKey);
    
    if (!stored) {
        return [];
    }
    
    try {
        return JSON.parse(stored);
    } catch {
        return [];
    }
}

/**
 * Add passkey to user's index
 */
export async function addPasskeyToIndex(db, username, credentialId, name = 'Unnamed Device') {
    const indexKey = `user:${username}:passkey:index`;
    const keys = await listUserPasskeys(db, username);
    
    // Add new key if not already present
    if (!keys.find(k => k.id === credentialId)) {
        keys.push({
            id: credentialId,
            name: name,
            created: Date.now()
        });
        
        await db.put(indexKey, JSON.stringify(keys));
    }
}

/**
 * Remove passkey from user's index
 */
export async function removePasskeyFromIndex(db, username, credentialId) {
    const indexKey = `user:${username}:passkey:index`;
    const keys = await listUserPasskeys(db, username);
    
    const filtered = keys.filter(k => k.id !== credentialId);
    
    if (filtered.length === 0) {
        await db.delete(indexKey);
    } else {
        await db.put(indexKey, JSON.stringify(filtered));
    }
}

/**
 * Update passkey counter and last used timestamp
 */
export async function updatePasskeyUsage(db, username, credentialId) {
    const key = getPasskeyKey(username, credentialId);
    const stored = await db.get(key);
    
    if (!stored) {
        throw new Error('Passkey not found');
    }
    
    try {
        const credential = JSON.parse(stored);
        credential.lastUsed = Date.now();
        credential.counter = (credential.counter || 0) + 1;
        
        await db.put(key, JSON.stringify(credential));
        return credential;
    } catch (err) {
        throw new Error(`Failed to update passkey usage: ${err.message}`);
    }
}

/**
 * Mark recovery code as used
 */
export async function markRecoveryCodeUsed(db, username, codeIndex) {
    const key = getRecoveryCodesKey(username);
    const stored = await db.get(key);
    
    if (!stored) {
        throw new Error('Recovery codes not found');
    }
    
    try {
        const entry = JSON.parse(stored);
        
        if (!entry.used) {
            entry.used = [];
        }
        
        if (!entry.used.includes(codeIndex)) {
            entry.used.push(codeIndex);
            await db.put(key, JSON.stringify(entry));
        }
        
        return entry;
    } catch (err) {
        throw new Error(`Failed to mark recovery code as used: ${err.message}`);
    }
}

/**
 * Get unused recovery code count
 */
export function getUnusedRecoveryCodeCount(recoveryEntry) {
    if (!recoveryEntry || !recoveryEntry.codes) {
        return 0;
    }
    
    const totalCodes = recoveryEntry.codes.length;
    const usedCodes = recoveryEntry.used ? recoveryEntry.used.length : 0;
    
    return totalCodes - usedCodes;
}

/**
 * Check if user has any passkeys
 */
export async function userHasPasskeys(db, username) {
    const indexKey = `user:${username}:passkey:index`;
    const stored = await db.get(indexKey);
    
    if (!stored) {
        return false;
    }
    
    try {
        const keys = JSON.parse(stored);
        return Array.isArray(keys) && keys.length > 0;
    } catch {
        return false;
    }
}

/**
 * Check if user has active recovery codes
 */
export async function userHasRecoveryCodes(db, username) {
    const key = getRecoveryCodesKey(username);
    const stored = await db.get(key);
    
    if (!stored) {
        return false;
    }
    
    try {
        const entry = JSON.parse(stored);
        const unused = getUnusedRecoveryCodeCount(entry);
        return unused > 0;
    } catch {
        return false;
    }
}

/**
 * Disable all passkeys for a user (emergency recovery)
 */
export async function disableAllPasskeys(db, username) {
    // Get all passkeys from index
    const indexKey = `user:${username}:passkey:index`;
    const keys = await listUserPasskeys(db, username);
    
    // Delete all credential entries
    for (const key of keys) {
        const credentialKey = getPasskeyKey(username, key.id);
        await db.delete(credentialKey);
    }
    
    // Delete index
    await db.delete(indexKey);
    
    // Delete recovery codes
    const recoveryKey = getRecoveryCodesKey(username);
    await db.delete(recoveryKey);
    
    return { success: true };
}

/**
 * Export all functions
 */
export default {
    createPasskeyCredential,
    createRecoveryCodesEntry,
    isValidCredentialId,
    isValidRecoveryCode,
    getPasskeyKey,
    getRecoveryCodesKey,
    getRegistrationChallengeKey,
    getAuthChallengeKey,
    getRecoveryAuthKey,
    listUserPasskeys,
    addPasskeyToIndex,
    removePasskeyFromIndex,
    updatePasskeyUsage,
    markRecoveryCodeUsed,
    getUnusedRecoveryCodeCount,
    userHasPasskeys,
    userHasRecoveryCodes,
    disableAllPasskeys
};
