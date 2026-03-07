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

import { handleCorsOptions } from './_cors.js';
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import {
    cleanupStaleSessionIndex,
    deindexSession,
    getSessionMeta,
    getSessionTokensFromIndex,
    getUserSessionTokens,
    indexSession
} from '../lib/kv-index.js';
import { checkKvRateLimit, buildRateLimitKey } from '../lib/rate-limit.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, DELETE, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

/**
 * Validate admin session
 */
async function validateAdminSession(db, request) {
    const token = getBearerToken(request);
    if (!token) {
        return { valid: false, error: 'No authorization token', status: 401 };
    }

    const session = await getSessionFromRequest(db, request);
    if (!session) {
        return { valid: false, error: 'Invalid or expired session', status: 401 };
    }

    if (session.role !== 'admin') {
        return { valid: false, error: 'Admin access required', status: 403 };
    }

    return { valid: true, session, token };
}

/**
 * GET: List all active sessions
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/sessions', 'anonymous');

    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    // Rate limit (KV-backed)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('sessions', ip), {
            maxAttempts: RATE_LIMIT.maxRequests,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Sessions/RateLimit', env);
    }
    if (!rateLimitOk) {
        logSecurityEvent({
            ...security,
            event: 'sessions_rate_limit_blocked',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'Rate limit exceeded (30 requests/minute). Try again later.' }, 429, env, request);
    }

    // Validate admin session
    const auth = await validateAdminSession(db, request);

    if (!auth.valid) {
        logSecurityEvent({
            ...security,
            event: 'sessions_admin_auth_failed',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: auth.error }, auth.status || 403, env, request);
    }

    try {
        await cleanupStaleSessionIndex(db, { maxChecks: 60 });
        const tokens = await getSessionTokensFromIndex(db);
        const sessionDataResults = await Promise.all(tokens.map(async (tokenId) => {
            let data = await getSessionMeta(db, tokenId);
            if (!data) {
                const raw = await db.get(`session:${tokenId}`);
                if (!raw) {
                    await deindexSession(db, tokenId);
                    return null;
                }
                try {
                    data = JSON.parse(raw);
                } catch {
                    await deindexSession(db, tokenId);
                    return null;
                }
                await indexSession(db, tokenId, data);
            }

            return { tokenId, data };
        }));

        const sessions = sessionDataResults
            .filter(result => result?.data)
            .map(result => ({
                tokenPreview: result.tokenId.substring(0, 8) + '...',
                username: result.data.username,
                role: result.data.role,
                created: result.data.created ? new Date(result.data.created).toISOString() : null,
                ip: result.data.ip || 'unknown',
                isCurrent: result.tokenId === auth.token
            }));

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
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/sessions', 'anonymous');

    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    // Rate limit (KV-backed)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('sessions', ip), {
            maxAttempts: RATE_LIMIT.maxRequests,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Sessions/RateLimit', env);
    }
    if (!rateLimitOk) {
        logSecurityEvent({
            ...security,
            event: 'sessions_rate_limit_blocked',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'Rate limit exceeded (30 requests/minute). Try again later.' }, 429, env, request);
    }

    // Validate admin session
    const auth = await validateAdminSession(db, request);

    if (!auth.valid) {
        logSecurityEvent({
            ...security,
            event: 'sessions_admin_auth_failed',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: auth.error }, auth.status || 403, env, request);
    }

    try {
        await cleanupStaleSessionIndex(db, { maxChecks: 60 });
        const body = await request.json();
        let revokedCount = 0;

        if (body.username && body.all) {
            // Revoke all sessions for a user
            const targetUsername = body.username.toLowerCase();

            // Prevent revoking own sessions if that's the target
            if (targetUsername === auth.session.username) {
                return jsonResponse({ error: 'Cannot revoke your own sessions' }, 400, env, request);
            }

            let tokens = await getUserSessionTokens(db, targetUsername);

            if (!tokens.length) {
                // Backward-compatible fallback for existing sessions without user-session index.
                const allTokens = await getSessionTokensFromIndex(db);
                const tokenChecks = await Promise.all(allTokens.map(async (tokenId) => {
                    const meta = await getSessionMeta(db, tokenId);
                    if (meta?.username) return { tokenId, username: meta.username };

                    const raw = await db.get(`session:${tokenId}`);
                    if (!raw) return null;
                    try {
                        const parsed = JSON.parse(raw);
                        return { tokenId, username: parsed?.username || null };
                    } catch {
                        return null;
                    }
                }));
                tokens = tokenChecks
                    .filter(entry => entry && entry.username === targetUsername)
                    .map(entry => entry.tokenId);
            }

            await Promise.all(tokens.map(async (tokenId) => {
                await db.delete(`session:${tokenId}`);
                await deindexSession(db, tokenId, targetUsername);
            }));
            revokedCount = tokens.length;
        } else {
            return jsonResponse({ error: 'username and all=true required' }, 400, env, request);
        }

        logSecurityEvent({
            ...security,
            event: 'sessions_revoked',
            actor: auth.session.username,
            outcome: 'allowed',
            details: { revoked: revokedCount }
        }, env);

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
