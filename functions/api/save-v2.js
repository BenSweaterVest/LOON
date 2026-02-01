/**
 * ============================================================================
 * LOON Save-v2 Endpoint (functions/api/save-v2.js)
 * ============================================================================
 * 
 * Phase 2 (Team Mode) content saving with Role-Based Access Control (RBAC).
 * Validates session tokens and enforces permission rules based on user roles.
 * 
 * ENDPOINT: POST /api/save-v2
 * 
 * REQUEST HEADERS:
 *   Authorization: Bearer <session-token>
 * 
 * REQUEST BODY:
 *   {
 *     "pageId": "demo",         // Page identifier (lowercase alphanumeric)
 *     "content": { ... }        // JSON content to save
 *   }
 * 
 * RESPONSE (Success):
 *   {
 *     "success": true,
 *     "commit": "abc123...",    // Git commit SHA
 *     "pageId": "demo",
 *     "modifiedBy": "admin"
 *   }
 * 
 * ROLE-BASED ACCESS CONTROL:
 *   | Role        | Create | Edit Own | Edit Others |
 *   |-------------|--------|----------|-------------|
 *   | admin       | Yes    | Yes      | Yes         |
 *   | editor      | Yes    | Yes      | Yes         |
 *   | contributor | Yes    | Yes      | No          |
 * 
 *   Contributors can only edit content where _meta.createdBy matches their
 *   username. Creating new content is allowed for all roles.
 * 
 * CONTENT METADATA:
 *   The system automatically injects/preserves metadata in saved content:
 *   {
 *     "_meta": {
 *       "createdBy": "username",       // Set on first save
 *       "created": "2026-01-30T...",   // Set on first save
 *       "modifiedBy": "username",      // Updated on every save
 *       "lastModified": "2026-01-30T..." // Updated on every save
 *     }
 *   }
 * 
 * REQUIRED:
 *   - KV Namespace binding: LOON_DB (for session validation)
 *   - GITHUB_TOKEN environment variable
 *   - GITHUB_REPO environment variable
 * 
 * SECURITY FEATURES:
 *   - Session token validation via KV
 *   - Rate limiting: 30 requests per minute per IP
 *   - Content size limit: 1MB maximum
 *   - Page ID sanitization (alphanumeric + hyphens only)
 *   - RBAC enforcement on every save
 * 
 * @module functions/api/save-v2
 * @version 2.0.0 (Phase 2 - Team Mode)
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

// Rate limiting
const saveAttempts = new Map();
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

/**
 * Check rate limit
 */
function checkRateLimit(ip) {
    const now = Date.now();
    const attempts = saveAttempts.get(ip) || [];
    const recent = attempts.filter(t => now - t < RATE_LIMIT.windowMs);
    
    if (recent.length >= RATE_LIMIT.maxRequests) {
        return false;
    }
    
    recent.push(now);
    saveAttempts.set(ip, recent);
    return true;
}

/**
 * Validate session and return session data
 */
async function validateSession(db, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    
    const token = authHeader.slice(7);
    const sessionRaw = await db.get(`session:${token}`);
    
    if (!sessionRaw) {
        return null;
    }
    
    return JSON.parse(sessionRaw);
}

/**
 * Fetch file from GitHub to check metadata
 */
async function fetchGitHubFile(env, path) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS'
        }
    });
    
    if (!res.ok) {
        if (res.status === 404) {
            return { exists: false, sha: null, content: null };
        }
        throw new Error(`GitHub GET failed: ${res.status}`);
    }
    
    const json = await res.json();
    const content = JSON.parse(atob(json.content));
    
    return {
        exists: true,
        sha: json.sha,
        content: content
    };
}

/**
 * Commit content to GitHub
 */
async function commitToGitHub(env, path, content, message, existingSha) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    
    const body = {
        message: message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    };
    
    if (existingSha) {
        body.sha = existingSha;
    }
    
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GitHub PUT failed: ${res.status} - ${errText}`);
    }
    
    const result = await res.json();
    return result.commit.sha;
}

/**
 * Check if user can edit this content (RBAC)
 */
function canUserEdit(session, existingContent) {
    const role = session.role;
    
    // Admins and editors can edit anything
    if (role === 'admin' || role === 'editor') {
        return { allowed: true };
    }
    
    // Contributors can only edit their own content
    if (role === 'contributor') {
        // New content: allowed
        if (!existingContent) {
            return { allowed: true };
        }
        
        // Existing content: must be the creator
        const meta = existingContent._meta || {};
        if (meta.createdBy === session.username) {
            return { allowed: true };
        }
        
        return {
            allowed: false,
            reason: 'Contributors can only edit content they created'
        };
    }
    
    // Unknown role: deny
    return { allowed: false, reason: 'Unknown role' };
}

/**
 * Handle POST request (Save)
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.LOON_DB;

    // Check bindings
    if (!db) {
        return jsonResponse({ error: 'KV not configured. See Phase 2 setup.' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip)) {
        return jsonResponse({ error: 'Rate limit exceeded. Try again later.' }, 429, env, request);
    }

    try {
        // Validate session
        const authHeader = request.headers.get('Authorization');
        const session = await validateSession(db, authHeader);

        if (!session) {
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }

        // Parse request body
        const { pageId, content } = await request.json();

        if (!pageId || !content) {
            return jsonResponse({ error: 'pageId and content required' }, 400, env, request);
        }

        // Sanitize pageId
        const sanitizedPageId = pageId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (sanitizedPageId !== pageId.toLowerCase()) {
            return jsonResponse({ error: 'Invalid pageId format' }, 400, env, request);
        }

        // Content size limit (1MB)
        const contentStr = JSON.stringify(content);
        if (contentStr.length > 1024 * 1024) {
            return jsonResponse({ error: 'Content exceeds 1MB limit' }, 413, env, request);
        }

        // Fetch existing file
        const filePath = `data/${sanitizedPageId}/content.json`;
        const existing = await fetchGitHubFile(env, filePath);

        // RBAC check
        const permission = canUserEdit(session, existing.content);
        if (!permission.allowed) {
            return jsonResponse({ error: permission.reason }, 403, env, request);
        }

        // Inject metadata
        const finalContent = { ...content };
        finalContent._meta = finalContent._meta || {};
        finalContent._meta.lastModified = new Date().toISOString();
        finalContent._meta.modifiedBy = session.username;

        if (!existing.exists || !existing.content?._meta?.createdBy) {
            // New content: set creator
            finalContent._meta.createdBy = session.username;
            finalContent._meta.created = new Date().toISOString();
        } else {
            // Existing content: preserve creator
            finalContent._meta.createdBy = existing.content._meta.createdBy;
            finalContent._meta.created = existing.content._meta.created;
        }

        // Commit to GitHub
        const commitMessage = `Update ${sanitizedPageId} by ${session.username} (${session.role})`;
        const sha = await commitToGitHub(env, filePath, finalContent, commitMessage, existing.sha);

        return jsonResponse({
            success: true,
            commit: sha,
            pageId: sanitizedPageId,
            modifiedBy: session.username
        }, 200, env, request);

    } catch (err) {
        console.error('Save error:', err);
        return jsonResponse({ error: 'Save failed', details: err.message }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * JSON response helper with configurable CORS.
 */
function jsonResponse(data, status = 200, env = null, request = null) {
    const headers = env && request
        ? getCorsHeaders(env, request, CORS_OPTIONS)
        : {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        };

    return new Response(JSON.stringify(data), { status, headers });
}
