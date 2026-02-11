/**
 * ============================================================================
 * LOON Sessions Endpoint (functions/api/sessions.js)
 * ============================================================================
 *
 * Admin-only endpoint to view and manage active sessions.
 * Useful for security monitoring and incident response.
 *
 * ENDPOINTS:
 *   GET    /api/sessions          - List all active sessions
 *   DELETE /api/sessions          - Revoke all sessions for a user
 *
 * AUTHENTICATION:
 *   Requires admin session token in Authorization header.
 *
 * GET /api/sessions
 *   Response: { "sessions": [{ username, role, created, ip }, ...] }
 *
 * DELETE /api/sessions
 *   Request: { "username": "user", "all": true }  // Revoke all user sessions
 *   Response: { "success": true, "revoked": 1 }
 *
 * USE CASES:
 *   - View who is currently logged in
 *   - Force logout a compromised account
 *   - Revoke all sessions during a security incident
 *
 * @module functions/api/sessions

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logError, jsonResponse } from './_response.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, DELETE, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

/**
 * Check rate limit using KV (persists across worker restarts)
 * Key format: ratelimit:sessions:{ip}
 * Value: JSON array of timestamps within window
 */
async function checkRateLimit(db, ip, env) {
    const now = Date.now();
    const key = `ratelimit:sessions:${ip}`;

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
        logError(err, 'Sessions/RateLimit', env);
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
    
    return { valid: true, session, token };
}

/**
 * GET: List all active sessions
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const db = env.LOON_DB || env.KV;

    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
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
        // List all sessions
        const list = await db.list({ prefix: 'session:' });
        
        // Parallel fetch all sessions to avoid N+1 query problem
        const sessionDataPromises = list.keys.map(key =>
            db.get(key.name, { type: 'json' }).then(sessionRaw => ({
                key: key.name,
                data: sessionRaw
            }))
        );
        
        const sessionDataResults = await Promise.all(sessionDataPromises);
        
        const sessions = sessionDataResults
            .filter(result => result.data)
            .map(result => {
                const tokenId = result.key.replace('session:', '');
                return {
                    tokenPreview: tokenId.substring(0, 8) + '...',
                    username: result.data.username,
                    role: result.data.role,
                    created: result.data.created ? new Date(result.data.created).toISOString() : null,
                    ip: result.data.ip || 'unknown',
                    isCurrent: tokenId === auth.token
                };
            });

        // Sort by creation time (newest first)
        sessions.sort((a, b) => {
            if (!a.created) return 1;
            if (!b.created) return -1;
            return new Date(b.created) - new Date(a.created);
        });

        return jsonResponse({
            sessions: sessions,
            total: sessions.length
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Sessions/List', env);
        return jsonResponse({ error: 'Failed to list sessions' }, 500, env, request);
    }
}

/**
 * DELETE: Revoke session(s)
 */
export async function onRequestDelete(context) {
    const { request, env } = context;
    const db = env.LOON_DB || env.KV;

    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
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
        const body = await request.json();
        let revokedCount = 0;

        if (body.username && body.all) {
            // Revoke all sessions for a user
            const targetUsername = body.username.toLowerCase();

            // Prevent revoking own sessions if that's the target
            if (targetUsername === auth.session.username) {
                return jsonResponse({ error: 'Cannot revoke your own sessions' }, 400, env, request);
            }

            const list = await db.list({ prefix: 'session:' });

            // Parallel fetch all sessions to avoid N+1 query problem
            const sessionDataPromises = list.keys.map(key =>
                db.get(key.name, { type: 'json' }).then(sessionRaw => ({
                    key: key.name,
                    data: sessionRaw
                }))
            );
            
            const sessionDataResults = await Promise.all(sessionDataPromises);
            
            // Parallel delete sessions belonging to target user
            const deletePromises = sessionDataResults
                .filter(result => result.data && result.data.username === targetUsername)
                .map(result => db.delete(result.key));
            
            revokedCount = deletePromises.length;
            await Promise.all(deletePromises);
        } else {
            return jsonResponse({ error: 'username and all=true required' }, 400, env, request);
        }

        return jsonResponse({
            success: true,
            revoked: revokedCount,
            message: revokedCount > 0 ? `Revoked ${revokedCount} session(s)` : 'No sessions found to revoke'
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Sessions/Revoke', env);
        return jsonResponse({ error: 'Failed to revoke sessions' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
