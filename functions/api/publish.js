/**
 * ============================================================================
 * LOON Publish Endpoint (functions/api/publish.js)
 * ============================================================================
 *
 * Draft/Publish workflow management. Allows admins and editors to promote
 * draft content to published state or unpublish content.
 *
 * ENDPOINT: POST /api/publish
 *
 * REQUEST HEADERS:
 *   Authorization: Bearer <session-token>
 *
 * REQUEST BODY:
 *   {
 *     "pageId": "blog-post",
 *     "action": "publish" | "unpublish"
 *   }
 *
 * RESPONSE (Success):
 *   {
 *     "success": true,
 *     "pageId": "blog-post",
 *     "status": "published",
 *     "publishedBy": "admin",
 *     "publishedAt": "2026-02-02T10:00:00Z"
 *   }
 *
 * PERMISSIONS:
 *   - Admin: Can publish/unpublish any content
 *   - Editor: Can publish/unpublish any content
 *   - Contributor: Cannot publish (must request approval)
 *
 * @module functions/api/publish
 * @version 3.1.0
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

/**
 * Validate session and check permissions
 */
async function validateSession(db, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'No authorization token' };
    }
    
    const token = authHeader.slice(7);
    const sessionKey = `session:${token}`;
    const sessionRaw = await db.get(sessionKey);
    
    if (!sessionRaw) {
        return { valid: false, error: 'Invalid or expired session' };
    }
    
    const session = JSON.parse(sessionRaw);
    return { valid: true, session };
}

/**
 * Check if user can publish content
 */
function canPublish(role) {
    return role === 'admin' || role === 'editor';
}

/**
 * Get content from GitHub
 */
async function getContentFromGitHub(env, pageId) {
    const [owner, repo] = env.GITHUB_REPO.split('/');
    const path = `data/${pageId}/content.json`;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const res = await fetch(url, {
        headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS/3.1.0'
        }
    });
    
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`GitHub API error: ${res.status}`);
    }
    
    const data = await res.json();
    const content = JSON.parse(atob(data.content));
    
    return { content, sha: data.sha };
}

/**
 * Save content to GitHub
 */
async function saveToGitHub(env, pageId, content, message, existingSha) {
    const [owner, repo] = env.GITHUB_REPO.split('/');
    const path = `data/${pageId}/content.json`;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const contentStr = JSON.stringify(content, null, 2);
    const contentBase64 = btoa(unescape(encodeURIComponent(contentStr)));
    
    const payload = {
        message,
        content: contentBase64,
        ...(existingSha && { sha: existingSha })
    };
    
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'LOON-CMS/3.1.0'
        },
        body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        const error = await res.text();
        throw new Error(`GitHub API error: ${res.status} - ${error}`);
    }
    
    const result = await res.json();
    return result.commit.sha;
}

/**
 * JSON response helper
 */
function jsonResponse(data, status, env, request) {
    return new Response(JSON.stringify(data), {
        status,
        headers: getCorsHeaders(env, request, CORS_OPTIONS)
    });
}

/**
 * Main handler
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return handleCorsOptions(env, request, CORS_OPTIONS);
    }
    
    const db = env.LOON_DB;
    if (!db) {
        return jsonResponse({ error: 'Database not configured' }, 500, env, request);
    }
    
    // Validate session
    const authHeader = request.headers.get('Authorization');
    const auth = await validateSession(db, authHeader);
    
    if (!auth.valid) {
        return jsonResponse({ error: auth.error || 'Unauthorized' }, 401, env, request);
    }
    
    const { session } = auth;
    
    // Check permissions
    if (!canPublish(session.role)) {
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
    const sanitizedPageId = pageId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    
    try {
        // Get existing content
        const existing = await getContentFromGitHub(env, sanitizedPageId);
        
        if (!existing) {
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
            
            const commitSha = await saveToGitHub(
                env,
                sanitizedPageId,
                content,
                `Publish ${sanitizedPageId} by ${session.username}`,
                sha
            );
            
            // Log audit
            await logAudit(db, 'content_publish', session.username, {
                pageId: sanitizedPageId,
                publishedBy: session.username,
                ip: request.headers.get('CF-Connecting-IP')
            });
            
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
            
            const commitSha = await saveToGitHub(
                env,
                sanitizedPageId,
                content,
                `Unpublish ${sanitizedPageId} by ${session.username}`,
                sha
            );
            
            // Log audit
            await logAudit(db, 'content_unpublish', session.username, {
                pageId: sanitizedPageId,
                unpublishedBy: session.username,
                ip: request.headers.get('CF-Connecting-IP')
            });
            
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
        console.error('Publish error:', error);
        return jsonResponse({ 
            error: 'Publish failed',
            details: error.message
        }, 500, env, request);
    }
}
