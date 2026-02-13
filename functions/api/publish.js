/**
 * Publish endpoint (`POST /api/publish`).
 * Promotes drafts to published content or unpublishes existing content.
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getUnchangedSanitizedPageId } from '../lib/page-id.js';
import { checkKvRateLimit, buildRateLimitKey } from '../lib/rate-limit.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson, putRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 20, windowMs: 60000 };

/**
 * Check if user can publish content
 */
function canPublish(role) {
    return role === 'admin' || role === 'editor';
}

/**
 * Main handler
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const security = buildSecurityContext(request, '/api/publish', 'anonymous');

    const db = getKVBinding(env);
    if (!db) {
        return jsonResponse({ error: 'Database not configured' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    // Rate limit (KV-backed)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('publish', ip), {
            maxAttempts: RATE_LIMIT.maxRequests,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Publish/RateLimit', env);
    }
    if (!rateLimitOk) {
        logSecurityEvent({
            ...security,
            event: 'publish_rate_limit_blocked',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'Rate limit exceeded (20 requests/minute). Try again later.' }, 429, env, request);
    }
    
    // Validate session
    const token = getBearerToken(request);
    if (!token) {
        logSecurityEvent({
            ...security,
            event: 'publish_auth_failed',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'No authorization token' }, 401, env, request);
    }

    const session = await getSessionFromRequest(db, request);

    if (!session) {
        logSecurityEvent({
            ...security,
            event: 'publish_auth_failed',
            outcome: 'denied'
        }, env);
        return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
    }
    security.actor = session.username;
    
    // Check permissions
    if (!canPublish(session.role)) {
        logSecurityEvent({
            ...security,
            event: 'publish_permission_denied',
            outcome: 'denied',
            details: { role: session.role }
        }, env);
        return jsonResponse({ 
            error: 'Only admins and editors can publish content',
            role: session.role
        }, 403, env, request);
    }
    
    // Parse request body
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: 'Invalid JSON' }, 400, env, request);
    }
    
    const { pageId, action } = body;
    
    if (!pageId || !action) {
        return jsonResponse({ error: 'pageId and action required' }, 400, env, request);
    }
    
    if (!['publish', 'unpublish'].includes(action)) {
        return jsonResponse({ error: 'action must be "publish" or "unpublish"' }, 400, env, request);
    }
    
    // Sanitize pageId
    const sanitizedPageId = getUnchangedSanitizedPageId(pageId);
    if (!sanitizedPageId) {
        return jsonResponse({ error: 'Invalid pageId format' }, 400, env, request);
    }
    
    try {
        // Get existing content
        const existing = await getRepoFileJson(env, `data/${sanitizedPageId}/content.json`);
        
        if (!existing.exists) {
            return jsonResponse({ error: 'Page not found' }, 404, env, request);
        }
        
        const { content, sha } = existing;
        
        // Check if content has draft/published structure
        if (!content._meta) {
            content._meta = {};
        }
        
        const now = new Date().toISOString();
        
        if (action === 'publish') {
            // Publish draft content
            if (!content.draft) {
                return jsonResponse({ error: 'No draft content to publish' }, 400, env, request);
            }
            
            content.published = content.draft;
            content._meta.status = 'published';
            content._meta.publishedAt = now;
            content._meta.publishedBy = session.username;
            
            const commitSha = await putRepoFileJson(env, `data/${sanitizedPageId}/content.json`, content, `Publish ${sanitizedPageId} by ${session.username}`, sha, { pretty: true });
            
            // Log audit
            await logAudit(db, 'content_publish', session.username, {
                pageId: sanitizedPageId,
                publishedBy: session.username,
                ip: request.headers.get('CF-Connecting-IP')
            });
            logSecurityEvent({
                ...security,
                event: 'content_published',
                outcome: 'allowed',
                details: { pageId: sanitizedPageId }
            }, env);
            
            return jsonResponse({
                success: true,
                pageId: sanitizedPageId,
                status: 'published',
                publishedBy: session.username,
                publishedAt: now,
                commit: commitSha
            }, 200, env, request);
            
        } else {
            // Unpublish content
            content._meta.status = 'draft';
            content._meta.unpublishedAt = now;
            content._meta.unpublishedBy = session.username;
            
            const commitSha = await putRepoFileJson(env, `data/${sanitizedPageId}/content.json`, content, `Unpublish ${sanitizedPageId} by ${session.username}`, sha, { pretty: true });
            
            // Log audit
            await logAudit(db, 'content_unpublish', session.username, {
                pageId: sanitizedPageId,
                unpublishedBy: session.username,
                ip: request.headers.get('CF-Connecting-IP')
            });
            logSecurityEvent({
                ...security,
                event: 'content_unpublished',
                outcome: 'allowed',
                details: { pageId: sanitizedPageId }
            }, env);
            
            return jsonResponse({
                success: true,
                pageId: sanitizedPageId,
                status: 'draft',
                unpublishedBy: session.username,
                unpublishedAt: now,
                commit: commitSha
            }, 200, env, request);
        }
        
    } catch (error) {
        logError(error, 'Publish', env);
        return jsonResponse({ 
            error: 'Publish failed'
        }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
