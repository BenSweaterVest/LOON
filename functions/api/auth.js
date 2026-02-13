/**
 * ============================================================================
 * LOON Auth Endpoint (functions/api/auth.js)
 * ============================================================================
 *
 * Session-based authentication using Cloudflare KV for user storage
 * and session tokens for authentication.
 *
 * ENDPOINTS:
 *   GET    /api/auth - Verify session token, get session info
 *   POST   /api/auth - Login and receive session token
 *   PATCH  /api/auth - Change own password (authenticated)
 *   DELETE /api/auth - Logout and invalidate session
 *
 * GET REQUEST (Session Verification):
 *   Headers: Authorization: Bearer <session-token>
 *   Response: { "valid": true, "username": "...", "role": "...", "expiresIn": 12345 }
 *
 * POST REQUEST (Login):
 *   Body: { "username": "admin", "password": "secret123" }
 *   Response: { "success": true, "token": "...", "role": "admin", "expiresIn": 86400 }
 *
 * PATCH REQUEST (Password Change):
 *   Headers: Authorization: Bearer <session-token>
 *   Body: { "currentPassword": "old", "newPassword": "new" }
 *   Response: { "success": true, "message": "Password changed" }
 *
 * DELETE REQUEST (Logout):
 *   Headers: Authorization: Bearer <session-token>
 *   Response: { "success": true, "message": "Logged out" }
 *
 * REQUIRED:
 *   - KV Namespace binding: LOON_DB
 *   - At least one admin user created (via /admin.html initial setup or bootstrap script)
 *
 * SECURITY FEATURES:
 *   - PBKDF2 password hashing (100,000 iterations)
 *   - Timing-safe password comparison
 *   - Rate limiting: 5 login attempts per minute per IP
 *   - Session tokens expire after 24 hours
 *   - Bootstrap users auto-upgrade to hashed passwords on first login
 *   - Password change requires current password verification
 *
 * KV DATA STRUCTURE:
 *   user:{username}    -> { role, hash, salt, created, ... }
 *   session:{token}    -> { username, role, created, ip } [TTL: 24h]
 *
 * @module functions/api/auth

 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import { checkKvRateLimit, buildRateLimitKey } from '../lib/rate-limit.js';
import { getBearerToken } from '../lib/session.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, POST, PATCH, DELETE, OPTIONS' };

// Rate limiting constants (KV-backed)
const RATE_LIMIT = { maxAttempts: 5, windowMs: 60000 }; // 5 attempts per minute

/**
 * Hash password using PBKDF2
 * Uses Web Crypto API available in Cloudflare Workers
 */
async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
}

/**
 * Timing-safe comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
        return false;
    }

    if (a.length !== b.length) {
        return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
    }

    return result === 0;
}

/**
 * Verify password against stored hash
 */
async function verifyPassword(password, storedHash, salt) {
    const computedHash = await hashPassword(password, salt);
    
    // Timing-safe comparison
    const encoder = new TextEncoder();
    const a = encoder.encode(computedHash);
    const b = encoder.encode(storedHash);
    
    return timingSafeEqual(a, b);
}

/**
 * Generate secure session token
 */
function generateSessionToken() {
    return crypto.randomUUID();
}

/**
 * Handle POST request (Login)
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/auth', 'anonymous');

    // Check KV binding exists
    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    // Rate limit check
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('auth', ip), {
            maxAttempts: RATE_LIMIT.maxAttempts,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Auth/RateLimit');
    }
    if (!rateLimitOk) {
        logSecurityEvent({
            ...security,
            event: 'auth_rate_limit_blocked',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'Too many login attempts. Try again later.' }, 429, env, request);
    }

    try {
        const { username, password } = await request.json();

        // Validate input
        if (!username || !password) {
            return jsonResponse({ error: 'Username and password required' }, 400, env, request);
        }

        // Sanitize username
        const sanitizedUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (sanitizedUsername !== username.toLowerCase()) {
            return jsonResponse({ error: 'Invalid username format' }, 400, env, request);
        }

        // Fetch user from KV
        const userRecord = await db.get(`user:${sanitizedUsername}`, { type: 'json' });

        if (!userRecord) {
            // Generic error to prevent username enumeration
            logSecurityEvent({
                ...security,
                event: 'auth_login_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'Invalid credentials' }, 401, env, request);
        }

        // Verify password
        let isValid = false;
        let updatedUserRecord = null;
        const nowIso = new Date().toISOString();

        if (userRecord.bootstrap) {
            // Bootstrap user: plain text comparison, then upgrade
            isValid = (password === userRecord.password);

            if (isValid) {
                // Upgrade to secure hash
                const salt = crypto.randomUUID();
                const hash = await hashPassword(password, salt);

                const upgradedUser = {
                    ...userRecord,
                    hash: hash,
                    salt: salt,
                    upgraded: nowIso
                };
                delete upgradedUser.password; // Remove plain password
                delete upgradedUser.bootstrap; // Remove bootstrap flag
                updatedUserRecord = upgradedUser;
            }
        } else {
            // Secure user: hash comparison
            isValid = await verifyPassword(password, userRecord.hash, userRecord.salt);
            if (isValid) {
                updatedUserRecord = { ...userRecord };
            }
        }

        if (!isValid) {
            logSecurityEvent({
                ...security,
                event: 'auth_login_failed',
                actor: sanitizedUsername,
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'Invalid credentials' }, 401, env, request);
        }

        if (updatedUserRecord) {
            updatedUserRecord.lastLogin = nowIso;
            updatedUserRecord.lastLoginIp = ip;
            await db.put(`user:${sanitizedUsername}`, JSON.stringify(updatedUserRecord));
        }

        // Create session
        const token = generateSessionToken();
        const sessionData = {
            username: sanitizedUsername,
            role: userRecord.role,
            created: Date.now(),
            ip: ip
        };

        // Store session in KV (expires in 24 hours)
        await db.put(`session:${token}`, JSON.stringify(sessionData), {
            expirationTtl: 86400 // 24 hours
        });

        // Audit log
        await logAudit(db, 'login', sanitizedUsername, { ip, role: userRecord.role });
        logSecurityEvent({
            ...security,
            event: 'auth_login_success',
            actor: sanitizedUsername,
            outcome: 'allowed'
        }, env);

        return jsonResponse({
            success: true,
            token: token,
            role: userRecord.role,
            username: sanitizedUsername,
            expiresIn: 86400
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Auth/Login');
        return jsonResponse({ error: 'Authentication failed' }, 500, env, request);
    }
}

/**
 * Handle GET request (Session Verification)
 * Verifies if a session token is still valid and returns session info.
 * 
 * Request:
 *   GET /api/auth
 *   Headers: Authorization: Bearer <session-token>
 * 
 * Response (200):
 *   { "valid": true, "username": "...", "role": "...", "expiresIn": 12345 }
 * 
 * Response (401):
 *   { "valid": false, "error": "Session expired" }
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);

    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    try {
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ valid: false, error: 'No token provided' }, 401, env, request);
        }
        const sessionRaw = await db.get(`session:${token}`);

        if (!sessionRaw) {
            return jsonResponse({ valid: false, error: 'Session expired or invalid' }, 401, env, request);
        }

        const session = JSON.parse(sessionRaw);

        // Calculate remaining time (sessions are created with 24h TTL)
        const createdAt = session.created || Date.now();
        const expiresAt = createdAt + (86400 * 1000); // 24 hours
        const expiresIn = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

        return jsonResponse({
            valid: true,
            username: session.username,
            role: session.role,
            expiresIn: expiresIn
        }, 200, env, request);

    } catch (err) {
        return jsonResponse({ valid: false, error: 'Session verification failed' }, 500, env, request);
    }
}

/**
 * Handle DELETE request (Logout)
 */
export async function onRequestDelete(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/auth', 'anonymous');

    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    try {
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ error: 'No token provided' }, 400, env, request);
        }

        // Get session info for audit log before deleting
        const sessionRaw = await db.get(`session:${token}`);
        let username = 'unknown';
        if (sessionRaw) {
            const session = JSON.parse(sessionRaw);
            username = session.username;
        }

        // Delete session from KV
        await db.delete(`session:${token}`);

        // Audit log
        await logAudit(db, 'logout', username, {});
        logSecurityEvent({
            ...security,
            event: 'auth_logout',
            actor: username,
            outcome: 'allowed'
        }, env);

        return jsonResponse({ success: true, message: 'Logged out' }, 200, env, request);

    } catch (err) {
        return jsonResponse({ error: 'Logout failed' }, 500, env, request);
    }
}

/**
 * Handle PATCH request (Change Own Password)
 * Allows authenticated users to change their own password.
 * 
 * Request:
 *   PATCH /api/auth
 *   Headers: Authorization: Bearer <session-token>
 *   Body: { "currentPassword": "...", "newPassword": "..." }
 * 
 * Response (200):
 *   { "success": true, "message": "Password changed" }
 */
export async function onRequestPatch(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/auth', 'anonymous');

    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    try {
        // Validate session
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ error: 'No token provided' }, 401, env, request);
        }
        const sessionRaw = await db.get(`session:${token}`);

        if (!sessionRaw) {
            return jsonResponse({ error: 'Session expired or invalid' }, 401, env, request);
        }

        const session = JSON.parse(sessionRaw);

        // Parse request body
        const { currentPassword, newPassword } = await request.json();

        if (!currentPassword || !newPassword) {
            return jsonResponse({ error: 'Current and new password required' }, 400, env, request);
        }

        if (newPassword.length < 8) {
            return jsonResponse({ error: 'New password must be at least 8 characters' }, 400, env, request);
        }

        // Fetch user record
        const userRecord = await db.get(`user:${session.username}`, { type: 'json' });

        if (!userRecord) {
            return jsonResponse({ error: 'User not found' }, 404, env, request);
        }

        // Verify current password
        let isCurrentValid = false;

        if (userRecord.bootstrap) {
            isCurrentValid = (currentPassword === userRecord.password);
        } else {
            isCurrentValid = await verifyPassword(currentPassword, userRecord.hash, userRecord.salt);
        }

        if (!isCurrentValid) {
            return jsonResponse({ error: 'Current password is incorrect' }, 401, env, request);
        }

        // Hash new password
        const newSalt = crypto.randomUUID();
        const newHash = await hashPassword(newPassword, newSalt);

        // Update user record
        const updatedUser = {
            ...userRecord,
            hash: newHash,
            salt: newSalt,
            bootstrap: false,
            passwordChanged: new Date().toISOString()
        };
        delete updatedUser.password; // Remove any bootstrap password

        await db.put(`user:${session.username}`, JSON.stringify(updatedUser));

        // Audit log
        await logAudit(db, 'password_change', session.username, {});
        logSecurityEvent({
            ...security,
            event: 'auth_password_change',
            actor: session.username,
            outcome: 'allowed'
        }, env);

        return jsonResponse({ success: true, message: 'Password changed successfully' }, 200, env, request);

    } catch (err) {
        logError(err, 'Auth/PasswordChange');
        return jsonResponse({ error: 'Password change failed' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
