/**
 * ============================================================================
 * LOON Audit Endpoint (functions/api/audit.js)
 * ============================================================================
 *
 * Admin-only endpoint for viewing audit logs.
 *
 * ENDPOINT:
 *   GET /api/audit - List recent audit logs
 *
 * QUERY PARAMETERS:
 *   ?action=login     - Filter by action type
 *   ?username=admin   - Filter by username
 *   ?limit=50         - Max results (default: 100, max: 500)
 *
 * RESPONSE:
 *   {
 *     "logs": [
 *       {
 *         "action": "login",
 *         "username": "admin",
 *         "details": { "ip": "1.2.3.4" },
 *         "timestamp": "2026-01-30T12:00:00.000Z"
 *       },
 *       ...
 *     ],
 *     "total": 25,
 *     "filters": { "action": "login" }
 *   }
 *
 * AUTHENTICATION:
 *   Admin role required
 *
 * @module functions/api/audit

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { getAuditLogs } from './_audit.js';
import { logError } from './_response.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

/**
 * Handle GET request - List audit logs
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const db = env.LOON_DB;

    // Check KV binding
    if (!db) {
        return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    }

    // Validate admin session
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Authentication required' }, 401, env, request);
    }

    const token = authHeader.slice(7);
    const sessionRaw = await db.get(`session:${token}`);

    if (!sessionRaw) {
        return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
    }

    const session = JSON.parse(sessionRaw);

    if (session.role !== 'admin') {
        return jsonResponse({ error: 'Admin role required' }, 403, env, request);
    }

    try {
        // Parse query parameters
        const url = new URL(request.url);
        const action = url.searchParams.get('action') || undefined;
        const username = url.searchParams.get('username') || undefined;
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));

        // Get audit logs
        const logs = await getAuditLogs(db, { action, username, limit });

        const filters = {};
        if (action) filters.action = action;
        if (username) filters.username = username;

        return jsonResponse({
            logs: logs,
            total: logs.length,
            filters: Object.keys(filters).length > 0 ? filters : undefined
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Audit/List');
        return jsonResponse({ error: 'Failed to retrieve audit logs' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, env = null, request = null) {
    const headers = env && request
        ? getCorsHeaders(env, request, CORS_OPTIONS)
        : {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        };

    return new Response(JSON.stringify(data), { status, headers });
}
