/**
 * ============================================================================
 * LOON Users Endpoint (functions/api/users.js)
 * ============================================================================
 *
 * User management API. Admin-only access for creating,
 * listing, updating, and deleting users.
 * 
 * ENDPOINTS:
 *   GET    /api/users - List all users
 *   POST   /api/users - Create new user
 *   PATCH  /api/users - Update user (role or password reset)
 *   DELETE /api/users - Remove user
 * 
 * AUTHENTICATION:
 *   All endpoints require admin session token in Authorization header:
 *   Authorization: Bearer <admin-session-token>
 * 
 * GET /api/users
 *   Response: { "users": [{ username, role, created, createdBy }, ...] }
 * 
 * POST /api/users
 *   Request:  { "username": "...", "role": "...", "password": "..." }
 *             (password is optional - auto-generated if not provided)
 *   Response: { "success": true, "username": "...", "password": "...", "role": "..." }
 *             (password returned so admin can share it with user)
 * 
 * PATCH /api/users
 *   Request:  { "username": "...", "role": "...", "resetPassword": true }
 *             (role and resetPassword are both optional)
 *   Response: { "success": true, "newRole": "...", "newPassword": "..." }
 * 
 * DELETE /api/users
 *   Request:  { "username": "..." }
 *   Response: { "success": true, "message": "User deleted" }
 *   Note: Also deletes all active sessions for the user
 * 
 * VALID ROLES:
 *   - admin: Full access, can manage other users
 *   - editor: Can edit any content
 *   - contributor: Can only edit own content
 * 
 * USERNAME REQUIREMENTS:
 *   - 3-32 characters
 *   - Lowercase letters, numbers, underscore, hyphen only
 *   - Stored as lowercase
 * 
 * PASSWORD HANDLING:
 *   - Minimum 8 characters
 *   - Hashed with PBKDF2 (100,000 iterations)
 *   - Auto-generated passwords use secure random characters
 * 
 * SECURITY:
 *   - Admin role required for all operations
 *   - Cannot delete your own account
 *   - Deleting user also invalidates their sessions
 * 
 * @module functions/api/users

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, POST, DELETE, PATCH, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

/**
 * Check rate limit using KV (persists across worker restarts)
 * Key format: ratelimit:users:{ip}
 * Value: JSON array of timestamps within window
 */
async function checkRateLimit(db, ip, env) {
    const now = Date.now();
    const key = `ratelimit:users:${ip}`;

    try {
        const stored = await db.get(key);
        let attempts = stored ? JSON.parse(stored) : [];

        const recent = attempts.filter(t => now - t < RATE_LIMIT.windowMs);

        if (recent.length >= RATE_LIMIT.maxRequests) {
            return false;
        }

        recent.push(now);

        await db.put(key, JSON.stringify(recent), {
            expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000)
        });

        return true;
    } catch (err) {
        logError(err, 'Users/RateLimit', env);
        return true;
    }
}

/**
 * Validate admin session
 */
async function validateAdminSession(db, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'No authorization token' };
    }
    
    const token = authHeader.slice(7);
    const sessionRaw = await db.get(`session:${token}`);
    
    if (!sessionRaw) {
        return { valid: false, error: 'Invalid or expired session' };
    }
    
    const session = JSON.parse(sessionRaw);
    
    if (session.role !== 'admin') {
        return { valid: false, error: 'Admin access required' };
    }
    
    return { valid: true, session };
}

/**
 * Hash password using PBKDF2
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
 * Generate secure random password
 */
function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const randomValues = new Uint8Array(16);
    crypto.getRandomValues(randomValues);
    
    // Use array instead of string concatenation to avoid creating intermediate strings
    const passwordChars = [];
    for (const val of randomValues) {
        passwordChars.push(chars[val % chars.length]);
    }
    return passwordChars.join('');
}

/**
 * Normalize and validate username
 */
function normalizeUsername(username) {
    if (!username || typeof username !== 'string') {
        return null;
    }

    const sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (sanitized.length < 3 || sanitized.length > 32) {
        return null;
    }

    return sanitized;
}

/**
 * GET: List all users
 */
async function handleGet(db, session, env, request) {
    const list = await db.list({ prefix: 'user:' });
    
    // Parallel fetch all users to avoid N+1 query problem
    const userDataPromises = list.keys.map(key => 
        db.get(key.name, { type: 'json' }).then(userRaw => ({
            key: key.name,
            data: userRaw
        }))
    );
    
    const userDataResults = await Promise.all(userDataPromises);
    
    const users = userDataResults
        .filter(result => result.data)
        .map(result => ({
            username: result.key.replace('user:', ''),
            role: result.data.role,
            created: result.data.created,
            createdBy: result.data.createdBy,
            lastLogin: result.data.lastLogin || null
        }));

    return jsonResponse({ users }, 200, env, request);
}

/**
 * POST: Create new user
 */
async function handlePost(db, session, body, env, request) {
    const { username, password, role } = body;

    // Validate inputs
    if (!username || !role) {
        return jsonResponse({ error: 'username and role required' }, 400, env, request);
    }

    // Validate role
    const validRoles = ['admin', 'editor', 'contributor'];
    if (!validRoles.includes(role)) {
        return jsonResponse({ error: `Invalid role. Must be: ${validRoles.join(', ')}` }, 400, env, request);
    }

    // Sanitize username
    const sanitizedUsername = normalizeUsername(username);
    if (!sanitizedUsername) {
        return jsonResponse({ error: 'Username must be 3-32 characters (letters, numbers, _ -)' }, 400, env, request);
    }

    // Check if user already exists
    const existing = await db.get(`user:${sanitizedUsername}`);
    if (existing) {
        return jsonResponse({ error: 'User already exists' }, 409, env, request);
    }

    // Generate or use provided password
    const userPassword = password || generatePassword();

    // Validate password strength
    if (userPassword.length < 8) {
        return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, env, request);
    }

    // Hash password
    const salt = crypto.randomUUID();
    const hash = await hashPassword(userPassword, salt);

    // Create user record
    const userRecord = {
        role: role,
        hash: hash,
        salt: salt,
        created: new Date().toISOString(),
        createdBy: session.username
    };

    await db.put(`user:${sanitizedUsername}`, JSON.stringify(userRecord));

    // Audit log
    await logAudit(db, 'user_create', session.username, { newUser: sanitizedUsername, role: role });

    return jsonResponse({
        success: true,
        username: sanitizedUsername,
        password: userPassword, // Return password so admin can share it
        role: role,
        message: 'User created. Share the password securely with the user.'
    }, 201, env, request);
}

/**
 * DELETE: Remove user
 */
async function handleDelete(db, session, body, env, request) {
    const { username } = body;

    if (!username) {
        return jsonResponse({ error: 'username required' }, 400, env, request);
    }

    const sanitizedUsername = normalizeUsername(username);
    if (!sanitizedUsername) {
        return jsonResponse({ error: 'Username must be 3-32 characters (letters, numbers, _ -)' }, 400, env, request);
    }

    // Prevent self-deletion
    if (sanitizedUsername === session.username) {
        return jsonResponse({ error: 'Cannot delete your own account' }, 400, env, request);
    }

    // Check user exists
    const existing = await db.get(`user:${sanitizedUsername}`);
    if (!existing) {
        return jsonResponse({ error: 'User not found' }, 404, env, request);
    }

    // Delete user
    await db.delete(`user:${sanitizedUsername}`);

    // Also delete any active sessions for this user
    // Parallel fetch all sessions to avoid N+1 query problem
    const sessions = await db.list({ prefix: 'session:' });
    const sessionDataPromises = sessions.keys.map(key =>
        db.get(key.name, { type: 'json' }).then(sessionData => ({
            key: key.name,
            data: sessionData
        }))
    );
    
    const sessionDataResults = await Promise.all(sessionDataPromises);
    
    // Parallel delete sessions belonging to this user
    const deletePromises = sessionDataResults
        .filter(result => result.data && result.data.username === sanitizedUsername)
        .map(result => db.delete(result.key));
    
    await Promise.all(deletePromises);

    // Audit log
    await logAudit(db, 'user_delete', session.username, { deletedUser: sanitizedUsername });

    return jsonResponse({
        success: true,
        message: `User ${sanitizedUsername} deleted`
    }, 200, env, request);
}

/**
 * PATCH: Update user (role or password reset)
 */
async function handlePatch(db, session, body, env, request) {
    const { username, role, resetPassword } = body;

    if (!username) {
        return jsonResponse({ error: 'username required' }, 400, env, request);
    }

    const sanitizedUsername = normalizeUsername(username);
    if (!sanitizedUsername) {
        return jsonResponse({ error: 'Username must be 3-32 characters (letters, numbers, _ -)' }, 400, env, request);
    }

    // Fetch existing user
    const userRaw = await db.get(`user:${sanitizedUsername}`, { type: 'json' });
    if (!userRaw) {
        return jsonResponse({ error: 'User not found' }, 404, env, request);
    }

    const updates = {};
    let newPassword = null;

    // Update role if provided
    if (role) {
        const validRoles = ['admin', 'editor', 'contributor'];
        if (!validRoles.includes(role)) {
            return jsonResponse({ error: `Invalid role. Must be: ${validRoles.join(', ')}` }, 400, env, request);
        }
        updates.role = role;
    }

    // Reset password if requested
    if (resetPassword) {
        newPassword = generatePassword();
        const salt = crypto.randomUUID();
        const hash = await hashPassword(newPassword, salt);
        updates.hash = hash;
        updates.salt = salt;
        updates.passwordReset = new Date().toISOString();
        updates.passwordResetBy = session.username;
    }

    if (Object.keys(updates).length === 0) {
        return jsonResponse({ error: 'No updates provided' }, 400, env, request);
    }

    // Apply updates
    const updatedUser = { ...userRaw, ...updates };
    await db.put(`user:${sanitizedUsername}`, JSON.stringify(updatedUser));

    // Audit log
    if (newPassword) {
        await logAudit(db, 'password_reset', session.username, { targetUser: sanitizedUsername });
    }
    if (role) {
        await logAudit(db, 'user_update', session.username, { targetUser: sanitizedUsername, newRole: role });
    }

    const response = {
        success: true,
        username: sanitizedUsername,
        message: 'User updated'
    };

    if (newPassword) {
        response.newPassword = newPassword;
        response.message = 'Password reset. Share the new password securely.';
    }

    if (role) {
        response.newRole = role;
    }

    return jsonResponse(response, 200, env, request);
}

/**
 * Main request handler
 */
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.LOON_DB;

    // Check KV binding
    if (!db) {
        return jsonResponse({ error: 'KV database not configured. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    // Rate limit (KV-backed)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await checkRateLimit(db, ip, env))) {
        return jsonResponse({ error: 'Rate limit exceeded (30 requests/minute). Try again later.' }, 429, env, request);
    }

    // Validate admin session
    const authHeader = request.headers.get('Authorization');
    const auth = await validateAdminSession(db, authHeader);

    if (!auth.valid) {
        return jsonResponse({ error: auth.error }, 403, env, request);
    }

    try {
        switch (request.method) {
            case 'GET':
                return handleGet(db, auth.session, env, request);

            case 'POST':
                const postBody = await request.json();
                return handlePost(db, auth.session, postBody, env, request);

            case 'DELETE':
                const deleteBody = await request.json();
                return handleDelete(db, auth.session, deleteBody, env, request);

            case 'PATCH':
                const patchBody = await request.json();
                return handlePatch(db, auth.session, patchBody, env, request);

            default:
                return jsonResponse({ error: 'Method not allowed' }, 405, env, request);
        }
    } catch (err) {
        logError(err, 'Users/Request', env);
        return jsonResponse({ error: 'Request failed' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
