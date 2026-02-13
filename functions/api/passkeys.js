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
import { decode } from 'cbor-x';
import {
    arrayBufferToBase64Url,
    base64UrlToArrayBuffer,
    getRandomBytes,
    verifyRecoveryCode,
    extractPublicKeyFromAttestation
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
    disableAllPasskeys,
    addCredentialIdToIndex,
    getUsernameFromCredentialId,
    deleteCredentialIdMapping
} from './_passkeys-schema.js';

const CORS_OPTIONS = {
    methods: 'GET, POST, PATCH, DELETE, OPTIONS'
};

/**
 * SHA-256 hash function
 */
async function sha256(data) {
    return await crypto.subtle.digest('SHA-256', data);
}

/**
 * Import a public key from CBOR COSE format
 * Converts CBOR-encoded public key to CryptoKey for verification
 * 
 * @param {string} cbor - Base64url-encoded CBOR public key
 * @returns {Promise<CryptoKey>} - Importable public key
 */
async function importPublicKeyFromCBOR(cbor) {
    try {
        // Decode CBOR
        const buffer = base64UrlToArrayBuffer(cbor);
        const coseKey = decode(new Uint8Array(buffer));
        
        // COSE key format for ES256 (ECDSA with SHA-256)
        // kty (1) = EC (2)
        // alg (3) = ES256 (-7)
        // crv (20) = P-256 (1)
        // x (-2) = x-coordinate (32 bytes)
        // y (-3) = y-coordinate (32 bytes)
        
        if (coseKey[1] !== 2) {
            throw new Error('Only EC (kty=2) public keys supported');
        }
        
        if (coseKey[3] !== -7) {
            throw new Error('Only ES256 (alg=-7) supported');
        }
        
        // Extract x and y coordinates
        const x = new Uint8Array(coseKey[-2]);
        const y = new Uint8Array(coseKey[-3]);
        
        if (x.byteLength !== 32 || y.byteLength !== 32) {
            throw new Error('Invalid coordinate size for P-256');
        }
        
        // Create JWK from coordinates
        const jwk = {
            kty: 'EC',
            crv: 'P-256',
            x: arrayBufferToBase64Url(x.buffer),
            y: arrayBufferToBase64Url(y.buffer)
        };
        
        // Import as CryptoKey
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, // not extractable
            ['verify']
        );
    } catch (err) {
        console.error('Failed to import public key:', err);
        throw new Error(`Public key import failed: ${err.message}`);
    }
}

// WebAuthn configuration - should be set via environment variables in production
// IMPORTANT: These must match your actual domain when deployed
// Set RP_ID and RP_ORIGIN in Cloudflare Pages environment variables
function getRPConfig(env) {
    const isProduction = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'prod';

    if (isProduction && (!env.RP_ID || !env.RP_ORIGIN)) {
        throw new Error('RP_ID and RP_ORIGIN must be set in production');
    }

    if (!isProduction && (!env.RP_ID || !env.RP_ORIGIN)) {
        console.warn('Passkeys: RP_ID/RP_ORIGIN not set, defaulting to localhost for development');
    }

    return {
        RP_ID: env.RP_ID || 'localhost',
        RP_NAME: env.RP_NAME || 'LOON CMS',
        ORIGIN: env.RP_ORIGIN || 'http://localhost:8788'
    };
}

/**
 * Validate session from Authorization header
 * 
 * Checks session token against KV store and returns user data if valid.
 * 
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment with LOON_DB binding
 * @returns {Promise<Object|null>} User session data or null if invalid
 */
async function validateSession(request, env) {
    if (!env.LOON_DB) {
        return null;
    }
    
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
        return null;
    }
    
    const token = auth.slice(7);
    const sessionRaw = await env.LOON_DB.get(`session:${token}`);
    
    if (!sessionRaw) {
        return null;
    }
    
    try {
        const session = JSON.parse(sessionRaw);
        return {
            token,
            username: session.username,
            role: session.role,
            created: session.created
        };
    } catch (err) {
        return null;
    }
}

/**
 * Generate registration challenge
 */
async function handleRegistrationChallenge(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }

    let rpConfig;
    try {
        rpConfig = getRPConfig(env);
    } catch {
        return new Response(
            JSON.stringify({ error: 'Passkeys not configured for this deployment. Set RP_ID and RP_ORIGIN, then redeploy.' }),
            { status: 503, headers: getCorsHeaders(env, request) }
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
                challengeToken: tokenB64,
                userId: userId,
                username: user.username,
                rpId: rpConfig.RP_ID,
                rpName: rpConfig.RP_NAME,
                attestation: 'none',
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
            { status: 200, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/Registration', env);
        return new Response(
            JSON.stringify({ error: 'Failed to generate challenge' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Verify registration attestation
 */
async function handleRegistrationVerify(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }

    try {
        const body = await request.json();
        const { attestationResponse, deviceName, challengeToken } = body;
        
        if (!attestationResponse || !attestationResponse.id) {
            return new Response(
                JSON.stringify({ error: 'Invalid attestation response' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Challenge token is required to look up the challenge
        if (!challengeToken) {
            return new Response(
                JSON.stringify({ error: 'Challenge token required for registration verification' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Validate credential ID format
        if (!isValidCredentialId(attestationResponse.id)) {
            return new Response(
                JSON.stringify({ error: 'Invalid credential ID format' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Retrieve stored challenge from KV
        const challengeKey = getRegistrationChallengeKey(challengeToken);
        const storedChallengeStr = await env.LOON_DB.get(challengeKey);
        
        if (!storedChallengeStr) {
            return new Response(
                JSON.stringify({ error: 'Challenge not found or expired' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        const storedChallenge = JSON.parse(storedChallengeStr);
        
        // Verify challenge belongs to the authenticated user
        // Prevents stolen challenge tokens from being reused by different users
        if (storedChallenge.username !== user.username) {
            return new Response(
                JSON.stringify({ error: 'Challenge does not belong to this user' }),
                { status: 403, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Get RP config with defaults
        const rpConfig = getRPConfig(env);
        
        // Validate attestation challenge and clientData before accepting registration
        try {
            if (!attestationResponse.response) {
                return new Response(
                    JSON.stringify({ error: 'Missing attestation response data' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            if (!attestationResponse.response.clientDataJSON) {
                return new Response(
                    JSON.stringify({ error: 'Missing client data' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            if (!attestationResponse.response.attestationObject) {
                return new Response(
                    JSON.stringify({ error: 'Missing attestation object' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            const clientDataBuffer = base64UrlToArrayBuffer(attestationResponse.response.clientDataJSON);
            const clientDataText = new TextDecoder().decode(clientDataBuffer);
            const clientData = JSON.parse(clientDataText);
            
            // Verify challenge matches what we stored
            if (clientData.challenge !== storedChallenge.challenge) {
                return new Response(
                    JSON.stringify({ error: 'Challenge mismatch in registration' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }
            
            // Verify type is webauthn.create
            if (clientData.type !== 'webauthn.create') {
                return new Response(
                    JSON.stringify({ error: 'Invalid client data type for registration' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }
            
            // Verify origin matches (using config with defaults)
            if (clientData.origin !== rpConfig.ORIGIN) {
                return new Response(
                    JSON.stringify({ error: 'Origin mismatch in registration' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            // Validate rpIdHash and flags in authenticator data
            const attestationBuffer = base64UrlToArrayBuffer(attestationResponse.response.attestationObject);
            const attestationObject = decode(new Uint8Array(attestationBuffer));

            if (!attestationObject.authData) {
                return new Response(
                    JSON.stringify({ error: 'Missing authenticator data' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            const authData = new Uint8Array(attestationObject.authData);
            const rpIdHash = authData.slice(0, 32);
            const expectedRpIdHash = new Uint8Array(
                await sha256(new TextEncoder().encode(rpConfig.RP_ID))
            );

            let rpIdMatch = true;
            for (let i = 0; i < 32; i++) {
                if (rpIdHash[i] !== expectedRpIdHash[i]) {
                    rpIdMatch = false;
                    break;
                }
            }

            if (!rpIdMatch) {
                return new Response(
                    JSON.stringify({ error: 'RP ID hash mismatch in registration' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            const flags = authData[32];
            const userPresent = !!(flags & 0x01);
            const attestedCredentialDataIncluded = !!(flags & 0x40);

            if (!userPresent) {
                return new Response(
                    JSON.stringify({ error: 'User not present during registration' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }

            if (!attestedCredentialDataIncluded) {
                return new Response(
                    JSON.stringify({ error: 'Missing attested credential data' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }
        } catch (err) {
            return new Response(
                JSON.stringify({ error: `Invalid attestation response: ${err.message}` }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Create passkey credential entry
        const publicKeyData = await extractPublicKeyFromAttestation(attestationResponse.response.attestationObject);
        if (publicKeyData.credentialId && publicKeyData.credentialId !== attestationResponse.id) {
            return new Response(
                JSON.stringify({ error: 'Credential ID mismatch in attestation' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        const credential = createPasskeyCredential(
            attestationResponse.id,
            publicKeyData.publicKey, // Store the COSE CBOR key as base64url string
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
        
        // Add to global credential ID reverse index (for usernamehint-free lookups if needed)
        await addCredentialIdToIndex(env.LOON_DB, attestationResponse.id, user.username);
        
        // Delete the used challenge token from KV
        await env.LOON_DB.delete(challengeKey);
        
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
        await logAudit(
            env.LOON_DB,
            'passkey_registered',
            user.username,
            { deviceName: credential.name, credentialId: attestationResponse.id }
        );
        
        return new Response(
            JSON.stringify({
                success: true,
                recoveryCodes: recoveryEntry.plainCodes,
                message: 'Passkey registered successfully. Save your recovery codes in a secure location!'
            }),
            { status: 201, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/RegisterVerify', env);
        return new Response(
            JSON.stringify({ error: 'Registration verification failed' }),
            { status: 400, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Generate authentication challenge
 */
async function handleAuthChallenge(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }

    let rpConfig;
    try {
        rpConfig = getRPConfig(env);
    } catch {
        return new Response(
            JSON.stringify({ error: 'Passkeys not configured for this deployment. Set RP_ID and RP_ORIGIN, then redeploy.' }),
            { status: 503, headers: getCorsHeaders(env, request) }
        );
    }

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
                challengeToken: tokenB64,
                rpId: rpConfig.RP_ID,
                allowCredentials: allowCredentials,
                timeout: 60000,
                userVerification: 'preferred'
            }),
            { status: 200, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/AuthChallenge', env);
        return new Response(
            JSON.stringify({ error: 'Failed to generate auth challenge' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Verify authentication assertion
 * 
 * IMPLEMENTATION COMPLETE: Full WebAuthn assertion verification
 * 
 * Verification steps:
 * 1. Retrieve stored challenge
 * 2. Parse and validate clientDataJSON (challenge, origin, type)
 * 3. Parse authenticatorData (RP ID hash, flags, counter)
 * 4. Retrieve stored public key
 * 5. Verify signature
 * 6. Generate real session token
 */
async function handleAuthVerify(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }

    try {
        const body = await request.json();
        const { assertionResponse, challengeToken } = body;
        
        if (!assertionResponse || !assertionResponse.id || !challengeToken) {
            return new Response(
                JSON.stringify({ error: 'Invalid assertion response or missing challenge token' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }

        if (!assertionResponse.response) {
            return new Response(
                JSON.stringify({ error: 'Missing assertion response data' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }

        if (!assertionResponse.response.clientDataJSON || !assertionResponse.response.authenticatorData) {
            return new Response(
                JSON.stringify({ error: 'Missing assertion client data or authenticator data' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }

        if (!assertionResponse.response.signature) {
            return new Response(
                JSON.stringify({ error: 'Missing assertion signature' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Step 1: Retrieve stored challenge
        const challengeKey = getAuthChallengeKey(challengeToken);
        const storedChallenge = await env.LOON_DB.get(challengeKey, { type: 'json' });
        
        if (!storedChallenge) {
            return new Response(
                JSON.stringify({ error: 'Challenge expired or invalid' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Step 2: Parse and validate clientDataJSON
        const clientDataJSON = base64UrlToArrayBuffer(assertionResponse.response.clientDataJSON);
        const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
        
        if (clientData.type !== 'webauthn.get') {
            return new Response(
                JSON.stringify({ error: 'Invalid assertion type' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        if (clientData.challenge !== storedChallenge.challenge) {
            return new Response(
                JSON.stringify({ error: 'Challenge mismatch' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        const rpConfig = getRPConfig(env);
        const expectedOrigin = rpConfig.ORIGIN;
        
        if (clientData.origin !== expectedOrigin) {
            return new Response(
                JSON.stringify({ error: `Origin mismatch: expected ${expectedOrigin}` }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Step 3: Parse authenticatorData
        const authenticatorData = base64UrlToArrayBuffer(assertionResponse.response.authenticatorData);
        const authDataView = new DataView(authenticatorData);
        
        // RP ID hash (32 bytes)
        const rpIdHash = new Uint8Array(authenticatorData, 0, 32);
        
        // Verify RP ID hash
        const expectedRpIdHash = await sha256(new TextEncoder().encode(rpConfig.RP_ID));
        const expectedRpIdHashArray = new Uint8Array(expectedRpIdHash);
        
        let rpIdMatch = true;
        for (let i = 0; i < 32; i++) {
            if (rpIdHash[i] !== expectedRpIdHashArray[i]) {
                rpIdMatch = false;
                break;
            }
        }
        
        if (!rpIdMatch) {
            return new Response(
                JSON.stringify({ error: 'RP ID hash mismatch' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Flags byte (1 byte at offset 32)
        const flags = authDataView.getUint8(32);
        const userPresent = !!(flags & 0x01);
        const userVerified = !!(flags & 0x04);
        
        if (!userPresent) {
            return new Response(
                JSON.stringify({ error: 'User not present' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Counter (4 bytes at offset 33)
        const signCount = authDataView.getUint32(33, false); // big-endian
        
        // Step 4: Retrieve stored credential and public key
        // First try usernamehint if provided, otherwise use reverse credential ID index
        let username = storedChallenge.usernameHint;
        
        if (!username) {
            // Optional: use reverse index to look up username from credential ID
            // Requires extra KV lookup but allows passkey auth without usernamehint
            username = await getUsernameFromCredentialId(env.LOON_DB, assertionResponse.id);
            
            if (!username) {
                return new Response(
                    JSON.stringify({ error: 'Username hint required for passkey authentication' }),
                    { status: 400, headers: getCorsHeaders(env, request) }
                );
            }
        }
        
        const credentialKey = getPasskeyKey(username, assertionResponse.id);
        const storedCredentialStr = await env.LOON_DB.get(credentialKey);
        
        if (!storedCredentialStr) {
            return new Response(
                JSON.stringify({ error: 'Passkey not found' }),
                { status: 404, headers: getCorsHeaders(env, request) }
            );
        }
        
        const storedCredential = JSON.parse(storedCredentialStr);
        
        // Verify counter (anti-cloning)
        if (signCount !== 0 && signCount <= storedCredential.counter) {
            await logAudit(
                env.LOON_DB,
                'passkey_counter_warning',
                username,
                { credentialId: assertionResponse.id, storedCounter: storedCredential.counter, receivedCounter: signCount }
            );
            // Continue but log warning
        }
        
        // Step 5: Verify signature
        // Full cryptographic signature verification using ES256 (ECDSA with SHA-256)
        
        const signature = base64UrlToArrayBuffer(assertionResponse.response.signature);
        
        if (!signature || signature.byteLength === 0) {
            return new Response(
                JSON.stringify({ error: 'Missing or invalid signature' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        try {
            // Hash client data
            const clientDataHash = await sha256(clientDataJSON);
            
            // Concatenate authenticator data and client data hash
            const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
            signedData.set(new Uint8Array(authenticatorData), 0);
            signedData.set(new Uint8Array(clientDataHash), authenticatorData.byteLength);
            
            // Import public key from CBOR
            const publicKey = await importPublicKeyFromCBOR(storedCredential.publicKey);
            
            // Verify signature
            const verified = await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                publicKey,
                signature,
                signedData
            );
            
            if (!verified) {
                await logAudit(
                    env.LOON_DB,
                    'passkey_signature_invalid',
                    username,
                    { credentialId: assertionResponse.id, reason: 'Signature verification failed' }
                );
                
                return new Response(
                    JSON.stringify({ error: 'Invalid signature' }),
                    { status: 403, headers: getCorsHeaders(env, request) }
                );
            }
        } catch (err) {
            logError(err, 'Passkeys/SignatureVerification', env);
            return new Response(
                JSON.stringify({ error: 'Signature verification failed' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Step 6: Generate session token
        const sessionToken = crypto.randomUUID();
        
        // Fetch user record for role
        const userRecord = await env.LOON_DB.get(`user:${username}`, { type: 'json' });
        
        if (!userRecord) {
            return new Response(
                JSON.stringify({ error: 'User not found' }),
                { status: 404, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Create session
        const sessionKey = `session:${sessionToken}`;
        const sessionData = {
            username,
            role: userRecord.role,
            created: Date.now(),
            ip: request.headers.get('CF-Connecting-IP') || 'unknown',
            method: 'passkey'
        };
        
        await env.LOON_DB.put(sessionKey, JSON.stringify(sessionData), {
            expirationTtl: 86400 // 24 hours
        });
        
        // Update credential usage
        storedCredential.lastUsed = Date.now();
        storedCredential.counter = Math.max(storedCredential.counter, signCount);
        await env.LOON_DB.put(credentialKey, JSON.stringify(storedCredential));
        
        // Delete challenge
        await env.LOON_DB.delete(challengeKey);
        
        // Log successful auth
        await logAudit(
            env.LOON_DB,
            'passkey_login',
            username,
            { credentialId: assertionResponse.id, userVerified }
        );
        
        return new Response(
            JSON.stringify({
                success: true,
                token: sessionToken,
                username,
                role: userRecord.role,
                expiresIn: 86400
            }),
            { status: 200, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/AuthVerify', env);
        return new Response(
            JSON.stringify({ error: `Authentication failed: ${err.message}` }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * List user's passkeys
 */
async function handleListPasskeys(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
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
            { status: 200, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        logError(err, 'Passkeys/List', env);
        return new Response(
            JSON.stringify({ error: 'Failed to list passkeys' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Update passkey name
 */
async function handleUpdatePasskey(request, env, credentialId) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }

    try {
        const body = await request.json();
        const { name } = body;
        
        if (!name || typeof name !== 'string') {
            return new Response(
                JSON.stringify({ error: 'Invalid name' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        const credentialKey = getPasskeyKey(user.username, credentialId);
        const stored = await env.LOON_DB.get(credentialKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'Passkey not found' }),
                { status: 404, headers: getCorsHeaders(env, request) }
            );
        }
        
        const credential = JSON.parse(stored);
        credential.name = name.slice(0, 50);
        
        await env.LOON_DB.put(credentialKey, JSON.stringify(credential));
        
        await logAudit(
            env.LOON_DB,
            'passkey_renamed',
            user.username,
            { credentialId, newName: credential.name }
        );
        
        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: getCorsHeaders(env, request) }
        );
    } catch (err) {
        logError(err, 'Passkeys/Update', env);
        return new Response(
            JSON.stringify({ error: 'Failed to update passkey' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Delete passkey
 */
async function handleDeletePasskey(request, env, credentialId) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }

    try {
        const credentialKey = getPasskeyKey(user.username, credentialId);
        const stored = await env.LOON_DB.get(credentialKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'Passkey not found' }),
                { status: 404, headers: getCorsHeaders(env, request) }
            );
        }
        
        // Delete credential
        await env.LOON_DB.delete(credentialKey);
        
        // Remove from index
        await removePasskeyFromIndex(env.LOON_DB, user.username, credentialId);
        
        // Clean up reverse credential ID index
        await deleteCredentialIdMapping(env.LOON_DB, credentialId);
        
        await logAudit(
            env.LOON_DB,
            'passkey_deleted',
            user.username,
            { credentialId }
        );
        
        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: getCorsHeaders(env, request) }
        );
    } catch (err) {
        logError(err, 'Passkeys/Delete', env);
        return new Response(
            JSON.stringify({ error: 'Failed to delete passkey' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Verify recovery code
 */
async function handleRecoveryVerify(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    try {
        const body = await request.json();
        const { username, recoveryCode } = body;
        
        if (!username || !recoveryCode) {
            return new Response(
                JSON.stringify({ error: 'Username and recovery code required' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        if (!isValidRecoveryCode(recoveryCode)) {
            return new Response(
                JSON.stringify({ error: 'Invalid recovery code format' }),
                { status: 400, headers: getCorsHeaders(env, request) }
            );
        }
        
        const recoveryKey = getRecoveryCodesKey(username);
        const stored = await env.LOON_DB.get(recoveryKey);
        
        if (!stored) {
            return new Response(
                JSON.stringify({ error: 'No recovery codes found for this user' }),
                { status: 404, headers: getCorsHeaders(env, request) }
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
                        
                        await logAudit(
                            env.LOON_DB,
                            'recovery_code_used',
                            username,
                            {}
                        );
                        
                        return new Response(
                            JSON.stringify({
                                success: true,
                                tempToken: tokenB64,
                                expiresIn: 900,
                                message: 'Recovery code verified. Use this token to authenticate and manage your account.'
                            }),
                            { status: 200, headers: { ...getCorsHeaders(env, request), 'Content-Type': 'application/json' } }
                        );
                    }
                }
            }
            
            // No matching code found
            return new Response(
                JSON.stringify({ error: 'Invalid or already used recovery code' }),
                { status: 401, headers: getCorsHeaders(env, request) }
            );
        } catch (err) {
            logError(err, 'Passkeys/RecoveryVerify', env);
            return new Response(
                JSON.stringify({ error: 'Recovery code verification failed' }),
                { status: 500, headers: getCorsHeaders(env, request) }
            );
        }
    } catch (err) {
        logError(err, 'Passkeys/Recovery', env);
        return new Response(
            JSON.stringify({ error: 'Recovery verification failed' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Disable all passkeys
 */
async function handleRecoveryDisable(request, env) {
    if (!env.LOON_DB) {
        return new Response(
            JSON.stringify({ error: 'KV binding missing (configure LOON_DB or KV)' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
    const user = await validateSession(request, env);
    if (!user) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: getCorsHeaders(env, request) }
        );
    }

    try {
        await disableAllPasskeys(env.LOON_DB, user.username);
        
        await logAudit(
            env.LOON_DB,
            'passkeys_disabled',
            user.username,
            {}
        );
        
        return new Response(
            JSON.stringify({ success: true, message: 'All passkeys and recovery codes disabled. Use password login.' }),
            { status: 200, headers: getCorsHeaders(env, request) }
        );
    } catch (err) {
        logError(err, 'Passkeys/Disable', env);
        return new Response(
            JSON.stringify({ error: 'Failed to disable passkeys' }),
            { status: 500, headers: getCorsHeaders(env, request) }
        );
    }
}

/**
 * Main handler
 */
export default {
    async fetch(request, env) {
        // Normalize KV binding so deployments using `KV` still work.
        const normalizedEnv = env.LOON_DB ? env : { ...env, LOON_DB: env.KV };

        if (request.method === 'OPTIONS') {
            return handleCorsOptions(normalizedEnv, request, CORS_OPTIONS);
        }
        
        const url = new URL(request.url);
        const path = url.pathname;
        
        // Routes
        if (path === '/api/passkeys/register/challenge') {
            if (request.method === 'GET') {
                return handleRegistrationChallenge(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys/register/verify') {
            if (request.method === 'POST') {
                return handleRegistrationVerify(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys/auth/challenge') {
            if (request.method === 'GET') {
                return handleAuthChallenge(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys/auth/verify') {
            if (request.method === 'POST') {
                return handleAuthVerify(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys/recovery/verify') {
            if (request.method === 'POST') {
                return handleRecoveryVerify(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys/recovery/disable') {
            if (request.method === 'POST') {
                return handleRecoveryDisable(request, normalizedEnv);
            }
        } else if (path === '/api/passkeys') {
            if (request.method === 'GET') {
                return handleListPasskeys(request, normalizedEnv);
            }
        } else if (path.match(/^\/api\/passkeys\/[^/]+$/)) {
            const credentialId = path.split('/').pop();
            
            if (request.method === 'PATCH') {
                return handleUpdatePasskey(request, normalizedEnv, credentialId);
            } else if (request.method === 'DELETE') {
                return handleDeletePasskey(request, normalizedEnv, credentialId);
            }
        }
        
        return new Response(
            JSON.stringify({ error: 'Not found' }),
            { status: 404, headers: getCorsHeaders(normalizedEnv, request) }
        );
    }
};
