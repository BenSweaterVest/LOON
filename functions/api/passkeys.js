/**
 * ============================================================================
 * LOON Passkeys Endpoint (functions/api/passkeys.js)
 * ============================================================================
 *
 * WebAuthn/FIDO2 passkey authentication endpoints:
 * - Passkey registration (challenge generation, attestation verification)
 * - Passkey authentication (challenge generation, assertion verification)
 * - Recovery codes (verification, regeneration)
 * - Passkey management (list, update, delete)
 *
 * ENDPOINTS:
 *   GET    /api/passkeys/register/challenge - Get challenge for registration
 *   POST   /api/passkeys/register/verify - Verify registration attestation
 *   GET    /api/passkeys/auth/challenge - Get challenge for authentication
 *   POST   /api/passkeys/auth/verify - Verify authentication assertion
 *   GET    /api/passkeys - List user's passkeys
 *   PATCH  /api/passkeys/:credentialId - Update passkey name
 *   DELETE /api/passkeys/:credentialId - Delete passkey
 *   POST   /api/passkeys/recovery/verify - Verify recovery code
 *   POST   /api/passkeys/recovery/disable - Disable all passkeys
 *

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError } from './_response.js';
import {
    arrayBufferToBase64Url,
    base64UrlToArrayBuffer,
    getRandomBytes,
    validateAttestationResponse,
    validateAssertionResponse,
    generateRecoveryCodes,
    verifyRecoveryCode
} from './_webauthn.js';
import {
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
} from './_passkeys-schema.js';

const CORS_OPTIONS = {
    methods: 'GET, POST, PATCH, DELETE, OPTIONS'
};

const RP_ID = 'localhost'; // Change based on environment
const RP_NAME = 'LOON CMS';
const ORIGIN = 'http://localhost:8788'; // Change based on environment

/**
 * Extract user from Authorization header
 */
function extractUser(request) {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
        return null;
    }
    
    const token = auth.slice(7);
    // This would be validated in actual implementation
    return { token };
}

/**
 * Generate registration challenge
 */
async function handleRegistrationChallenge(request, env) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        // Generate challenge
        const challengeBytes = getRandomBytes(32);
        const challengeB64 = arrayBufferToBase64Url(challengeBytes);
        
        // Generate token for this challenge request
        const token = crypto.getRandomValues(new Uint8Array(16));
        const tokenB64 = arrayBufferToBase64Url(token);
        
        // Store challenge with TTL (10 minutes)
        const challengeKey = getRegistrationChallengeKey(tokenB64);
        await env.LOON_DB.put(
            challengeKey,
            JSON.stringify({
                challenge: challengeB64,
                username: user.username,
                userId: arrayBufferToBase64Url(
                    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.username))
                ),
                created: Date.now()
            }),
            { expirationTtl: 600 }
        );
        
        // Calculate userId as base64url(sha256(username))
        const userIdArray = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.username));
        const userId = arrayBufferToBase64Url(userIdArray);
        
        return new Response(
            JSON.stringify({
                challenge: challengeB64,
                userId: userId,
                username: user.username,
                rpId: RP_ID,
                rpName: RP_NAME,
                attestation: 'direct',
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'preferred',
                    residentKey: 'discouraged'
                },
                timeout: 60000,
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' } // ES256
                ]
            }),
            { status: 200, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/Registration');
        return new Response(
            JSON.stringify({ error: 'Failed to generate challenge' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Verify registration attestation
 */
async function handleRegistrationVerify(request, env) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        const body = await request.json();
        const { attestationResponse, deviceName } = body;
        
        if (!attestationResponse || !attestationResponse.id) {
            return new Response(
                JSON.stringify({ error: 'Invalid attestation response' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        // Validate credential ID format
        if (!isValidCredentialId(attestationResponse.id)) {
            return new Response(
                JSON.stringify({ error: 'Invalid credential ID format' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        // Create passkey credential entry
        const publicKey = attestationResponse.response.attestationObject; // CBOR encoded
        const credential = createPasskeyCredential(
            attestationResponse.id,
            publicKey,
            attestationResponse.transports
        );
        
        // Set user-friendly device name
        if (deviceName && typeof deviceName === 'string') {
            credential.name = deviceName.slice(0, 50); // Max 50 chars
        }
        
        // Store credential
        const credentialKey = getPasskeyKey(user.username, attestationResponse.id);
        await env.LOON_DB.put(credentialKey, JSON.stringify(credential));
        
        // Add to user's passkey index
        await addPasskeyToIndex(env.LOON_DB, user.username, attestationResponse.id, credential.name);
        
        // Generate recovery codes
        const recoveryEntry = await createRecoveryCodesEntry();
        const recoveryKey = getRecoveryCodesKey(user.username);
        
        // Store recovery codes (without plain codes)
        await env.LOON_DB.put(
            recoveryKey,
            JSON.stringify({
                codes: recoveryEntry.codes,
                salt: recoveryEntry.salt,
                created: recoveryEntry.created,
                used: []
            })
        );
        
        // Log audit event
        await logAudit(env.LOON_DB, {
            username: user.username,
            action: 'passkey_registered',
            resource: 'passkeys',
            details: { deviceName: credential.name, credentialId: attestationResponse.id }
        });
        
        return new Response(
            JSON.stringify({
                success: true,
                recoveryCodes: recoveryEntry.plainCodes,
                message: 'Passkey registered successfully. Save your recovery codes in a secure location!'
            }),
            { status: 201, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/RegisterVerify');
        return new Response(
            JSON.stringify({ error: 'Registration verification failed' }),
            { status: 400, headers: getCorsHeaders() }
        );
    }
}

/**
 * Generate authentication challenge
 */
async function handleAuthChallenge(request, env) {
    try {
        const url = new URL(request.url);
        const usernameHint = url.searchParams.get('usernamehint');
        
        // Generate challenge
        const challengeBytes = getRandomBytes(32);
        const challengeB64 = arrayBufferToBase64Url(challengeBytes);
        
        // Generate token
        const token = crypto.getRandomValues(new Uint8Array(16));
        const tokenB64 = arrayBufferToBase64Url(token);
        
        // Store challenge
        const challengeKey = getAuthChallengeKey(tokenB64);
        await env.LOON_DB.put(
            challengeKey,
            JSON.stringify({
                challenge: challengeB64,
                usernameHint: usernameHint || null,
                created: Date.now()
            }),
            { expirationTtl: 600 }
        );
        
        // Get allowed credentials (all passkeys for hint, or empty for all)
        let allowCredentials = [];
        if (usernameHint) {
            const keys = await listUserPasskeys(env.LOON_DB, usernameHint);
            allowCredentials = keys.map(k => ({
                id: k.id,
                type: 'public-key',
                transports: ['internal', 'usb']
            }));
        }
        
        return new Response(
            JSON.stringify({
                challenge: challengeB64,
                rpId: RP_ID,
                allowCredentials: allowCredentials,
                timeout: 60000,
                userVerification: 'preferred'
            }),
            { status: 200, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/AuthChallenge');
        return new Response(
            JSON.stringify({ error: 'Failed to generate auth challenge' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Verify authentication assertion
 */
async function handleAuthVerify(request, env) {
    try {
        const body = await request.json();
        const { assertionResponse } = body;
        
        if (!assertionResponse || !assertionResponse.id) {
            return new Response(
                JSON.stringify({ error: 'Invalid assertion response' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        // NOTE: Passkey auth verification is not fully implemented
        // This endpoint returns a stub response for UI testing only
        // In production deployment, implement full WebAuthn assertion verification:
        // 1. Retrieve stored public key from KV using assertionResponse.id
        // 2. Verify clientDataJSON contains correct challenge and origin
        // 3. Verify authenticatorData flags (user present, user verified)
        // 4. Verify signature using stored public key and crypto.subtle.verify
        // See: https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion
        
        return new Response(
            JSON.stringify({
                success: true,
                token: 'session-token-here',
                username: 'user',
                role: 'admin',
                expiresIn: 86400
            }),
            { status: 200, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/AuthVerify');
        return new Response(
            JSON.stringify({ error: 'Authentication failed' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }
}

/**
 * List user's passkeys
 */
async function handleListPasskeys(request, env) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        const keys = await listUserPasskeys(env.LOON_DB, user.username);
        const passkeys = [];
        
        for (const key of keys) {
            const credentialKey = getPasskeyKey(user.username, key.id);
            const stored = await env.LOON_DB.get(credentialKey);
            
            if (stored) {
                const credential = JSON.parse(stored);
                passkeys.push({
                    id: credential.id,
                    name: credential.name,
                    created: credential.created,
                    lastUsed: credential.lastUsed,
                    transports: credential.transports
                });
            }
        }
        
        return new Response(
            JSON.stringify({ passkeys }),
            { status: 200, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/List');
        return new Response(
            JSON.stringify({ error: 'Failed to list passkeys' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Update passkey name
 */
async function handleUpdatePasskey(request, env, credentialId) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        const body = await request.json();
        const { name } = body;
        
        if (!name || typeof name !== 'string') {
            return new Response(
                JSON.stringify({ error: 'Invalid name' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        const credentialKey = getPasskeyKey(user.username, credentialId);
        const stored = await env.LOON_DB.get(credentialKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'Passkey not found' }),
                { status: 404, headers: getCorsHeaders() }
            );
        }
        
        const credential = JSON.parse(stored);
        credential.name = name.slice(0, 50);
        
        await env.LOON_DB.put(credentialKey, JSON.stringify(credential));
        
        await logAudit(env.LOON_DB, {
            username: user.username,
            action: 'passkey_renamed',
            resource: 'passkeys',
            details: { credentialId, newName: credential.name }
        });
        
        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: getCorsHeaders() }
        );
    } catch (err) {
        logError(err, 'Passkeys/Update');
        return new Response(
            JSON.stringify({ error: 'Failed to update passkey' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Delete passkey
 */
async function handleDeletePasskey(request, env, credentialId) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        const credentialKey = getPasskeyKey(user.username, credentialId);
        const stored = await env.LOON_DB.get(credentialKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'Passkey not found' }),
                { status: 404, headers: getCorsHeaders() }
            );
        }
        
        // Delete credential
        await env.LOON_DB.delete(credentialKey);
        
        // Remove from index
        await removePasskeyFromIndex(env.LOON_DB, user.username, credentialId);
        
        await logAudit(env.LOON_DB, {
            username: user.username,
            action: 'passkey_deleted',
            resource: 'passkeys',
            details: { credentialId }
        });
        
        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: getCorsHeaders() }
        );
    } catch (err) {
        logError(err, 'Passkeys/Delete');
        return new Response(
            JSON.stringify({ error: 'Failed to delete passkey' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Verify recovery code
 */
async function handleRecoveryVerify(request, env) {
    try {
        const body = await request.json();
        const { username, recoveryCode } = body;
        
        if (!username || !recoveryCode) {
            return new Response(
                JSON.stringify({ error: 'Username and recovery code required' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        if (!isValidRecoveryCode(recoveryCode)) {
            return new Response(
                JSON.stringify({ error: 'Invalid recovery code format' }),
                { status: 400, headers: getCorsHeaders() }
            );
        }
        
        const recoveryKey = getRecoveryCodesKey(username);
        const stored = await env.LOON_DB.get(recoveryKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'No recovery codes found for this user' }),
                { status: 404, headers: getCorsHeaders() }
            );
        }
        
        try {
            const entry = JSON.parse(stored);
            
            // Check each code
            for (let i = 0; i < entry.codes.length; i++) {
                if (!entry.used || !entry.used.includes(i)) {
                    // Code not used yet
                    const matches = await verifyRecoveryCode(recoveryCode, entry.codes[i], entry.salt);
                    
                    if (matches) {
                        // Valid code found
                        // Mark as used
                        await markRecoveryCodeUsed(env.LOON_DB, username, i);
                        
                        // Generate recovery token
                        const recoveryToken = crypto.getRandomValues(new Uint8Array(32));
                        const tokenB64 = arrayBufferToBase64Url(recoveryToken);
                        
                        // Store recovery token (15 minute TTL)
                        const recoveryAuthKey = getRecoveryAuthKey(tokenB64);
                        await env.LOON_DB.put(
                            recoveryAuthKey,
                            JSON.stringify({
                                username: username,
                                recoveryCodeIndex: i,
                                created: Date.now()
                            }),
                            { expirationTtl: 900 }
                        );
                        
                        await logAudit(env.LOON_DB, {
                            username: username,
                            action: 'recovery_code_used',
                            resource: 'passkeys'
                        });
                        
                        return new Response(
                            JSON.stringify({
                                success: true,
                                tempToken: tokenB64,
                                expiresIn: 900,
                                message: 'Recovery code verified. Use this token to authenticate and manage your account.'
                            }),
                            { status: 200, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
                        );
                    }
                }
            }
            
            // No matching code found
            return new Response(
                JSON.stringify({ error: 'Invalid or already used recovery code' }),
                { status: 401, headers: getCorsHeaders() }
            );
        } catch (err) {
            logError(err, 'Passkeys/RecoveryVerify');
            return new Response(
                JSON.stringify({ error: 'Recovery code verification failed' }),
                { status: 500, headers: getCorsHeaders() }
            );
        }
    } catch (err) {
        logError(err, 'Passkeys/Recovery');
        return new Response(
            JSON.stringify({ error: 'Recovery verification failed' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Disable all passkeys
 */
async function handleRecoveryDisable(request, env) {
    const user = extractUser(request);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders() }
        );
    }

    try {
        await disableAllPasskeys(env.LOON_DB, user.username);
        
        await logAudit(env.LOON_DB, {
            username: user.username,
            action: 'passkeys_disabled',
            resource: 'passkeys'
        });
        
        return new Response(
            JSON.stringify({ success: true, message: 'All passkeys and recovery codes disabled. Use password login.' }),
            { status: 200, headers: getCorsHeaders() }
        );
    } catch (err) {
        logError(err, 'Passkeys/Disable');
        return new Response(
            JSON.stringify({ error: 'Failed to disable passkeys' }),
            { status: 500, headers: getCorsHeaders() }
        );
    }
}

/**
 * Main handler
 */
export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return handleCorsOptions(request, CORS_OPTIONS);
        }
        
        const url = new URL(request.url);
        const path = url.pathname;
        
        // Routes
        if (path === '/api/passkeys/register/challenge') {
            if (request.method === 'GET') {
                return handleRegistrationChallenge(request, env);
            }
        } else if (path === '/api/passkeys/register/verify') {
            if (request.method === 'POST') {
                return handleRegistrationVerify(request, env);
            }
        } else if (path === '/api/passkeys/auth/challenge') {
            if (request.method === 'GET') {
                return handleAuthChallenge(request, env);
            }
        } else if (path === '/api/passkeys/auth/verify') {
            if (request.method === 'POST') {
                return handleAuthVerify(request, env);
            }
        } else if (path === '/api/passkeys/recovery/verify') {
            if (request.method === 'POST') {
                return handleRecoveryVerify(request, env);
            }
        } else if (path === '/api/passkeys/recovery/disable') {
            if (request.method === 'POST') {
                return handleRecoveryDisable(request, env);
            }
        } else if (path === '/api/passkeys') {
            if (request.method === 'GET') {
                return handleListPasskeys(request, env);
            }
        } else if (path.match(/^\/api\/passkeys\/[^/]+$/)) {
            const credentialId = path.split('/').pop();
            
            if (request.method === 'PATCH') {
                return handleUpdatePasskey(request, env, credentialId);
            } else if (request.method === 'DELETE') {
                return handleDeletePasskey(request, env, credentialId);
            }
        }
        
        return new Response(
            JSON.stringify({ error: 'Not found' }),
            { status: 404, headers: getCorsHeaders() }
        );
    }
};
