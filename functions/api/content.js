/**
 * ============================================================================
 * LOON Content Endpoint (functions/api/content.js)
 * ============================================================================
 *
 * Content management operations beyond save - currently supports deletion.
 * Requires session token authentication.
 *
 * ENDPOINTS:
 *   DELETE /api/content - Delete a page's content (admin/editor only)
 *
 * DELETE /api/content
 *   Request: { "pageId": "page-to-delete" }
 *   Response: { "success": true, "message": "Content deleted", "commit": "sha" }
 *
 * PERMISSIONS:
 *   - Admin: Can delete any content
 *   - Editor: Can delete any content
 *   - Contributor: Cannot delete (403)
 *
 * NOTE: This deletes content.json only, not schema.json. The page structure
 * remains, allowing content to be recreated. To fully remove a page,
 * delete the folder via Git.
 *
 * @module functions/api/content

 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getUnchangedSanitizedPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { deleteRepoFile } from '../lib/github.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'DELETE, OPTIONS' };

/**
 * Validate session and check permissions
 */
async function validateSession(db, request, requiredRoles = ['admin', 'editor']) {
    const token = getBearerToken(request);
    if (!token) {
        return { valid: false, error: 'No authorization token', status: 401 };
    }

    const session = await getSessionFromRequest(db, request);
    if (!session) {
        return { valid: false, error: 'Invalid or expired session', status: 401 };
    }

    if (!requiredRoles.includes(session.role)) {
        return { valid: false, error: `Requires ${requiredRoles.join(' or ')} role`, status: 403 };
    }
    
    return { valid: true, session };
}

/**
 * Handle DELETE request - Delete content
 */
export async function onRequestDelete(context) {
    const { request, env } = context;
    const db = getKVBinding(env);

    // Check bindings
    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    // Validate session (admin or editor only)
    const auth = await validateSession(db, request, ['admin', 'editor']);

    if (!auth.valid) {
        return jsonResponse({ error: auth.error }, auth.status, env, request);
    }

    try {
        const body = await request.json();
        const { pageId } = body;

        if (!pageId) {
            return jsonResponse({ error: 'pageId required' }, 400, env, request);
        }

        // Sanitize pageId
        const sanitizedPageId = getUnchangedSanitizedPageId(pageId);
        if (!sanitizedPageId) {
            return jsonResponse({ error: 'Invalid pageId format' }, 400, env, request);
        }

        // Delete content.json
        const filePath = `data/${sanitizedPageId}/content.json`;
        const commitMessage = `Delete ${sanitizedPageId} content by ${auth.session.username} (${auth.session.role})`;

        const result = await deleteRepoFile(env, filePath, commitMessage);

        if (!result.success) {
            return jsonResponse({ error: result.error }, 404, env, request);
        }

        // Audit log
        await logAudit(db, 'content_delete', auth.session.username, { pageId: sanitizedPageId, commit: result.commit });

        return jsonResponse({
            success: true,
            message: `Content for "${sanitizedPageId}" deleted`,
            commit: result.commit,
            deletedBy: auth.session.username
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Content/Delete');
        return jsonResponse({ error: 'Delete failed' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
