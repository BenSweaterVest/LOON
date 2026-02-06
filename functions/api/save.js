/**
 * ============================================================================
 * LOON Save Endpoint (functions/api/save.js)
 * ============================================================================
 *
 * Content saving with Role-Based Access Control (RBAC).
 * Validates session tokens and enforces permission rules based on user roles.
 *
 * ENDPOINT: POST /api/save
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
 * @module functions/api/save
 
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

/**
 * Check rate limit using KV (persists across worker restarts)
 * Key format: ratelimit:save:{ip}
 * Value: JSON array of timestamps within window
 */
async function checkRateLimit(db, ip) {
    const now = Date.now();
    const key = `ratelimit:save:${ip}`;
    
    try {
        const stored = await db.get(key);
        let attempts = stored ? JSON.parse(stored) : [];
        
        // Filter to only recent attempts
        const recent = attempts.filter(t => now - t < RATE_LIMIT.windowMs);
        
        if (recent.length >= RATE_LIMIT.maxRequests) {
            return false;
        }
        
        // Add current attempt
        recent.push(now);
        
        // Store updated attempts with TTL matching rate limit window
        await db.put(key, JSON.stringify(recent), {
            expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000)
        });
        
        return true;
    } catch (err) {
        logError(err, 'Save/RateLimit');
        // Fail open on KV errors (don't block requests)
        return true;
    }
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
            'User-Agent': 'LOON-CMS/1.0', 
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
 * Commit content to GitHub with exponential backoff retry
 * Handles transient failures (rate limits, timeouts) gracefully
 * Retries on: 429 (rate limit), 5xx errors, network failures
 */
async function commitToGitHub(env, path, content, message, existingSha, retries = 3) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    
    const body = {
        message: message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content)))),
    };
    
    if (existingSha) {
        body.sha = existingSha;
    }
    
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'LOON-CMS/1.0', 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            
            if (res.ok) {
                const result = await res.json();
                return result.commit.sha;
            }
            
            // Check if error is retryable
            if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
                const errText = await res.text();
                lastError = new Error(`GitHub API error: ${res.status} - ${errText}`);
                
                // Only retry if we have attempts left
                if (attempt < retries - 1) {
                    // Exponential backoff: 1s, 2s, 4s
                    const backoffMs = Math.pow(2, attempt) * 1000;
                    console.warn(`GitHub API error (attempt ${attempt + 1}/${retries}), retrying in ${backoffMs}ms: ${res.status}`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue;
                }
            } else {
                // Non-retryable error (4xx except 429)
                const errText = await res.text();
                throw new Error(`GitHub PUT failed: ${res.status} - ${errText}`);
            }
        } catch (err) {
            lastError = err;
            if (attempt < retries - 1 && (err instanceof TypeError || err.message.includes('fetch failed'))) {
                const backoffMs = Math.pow(2, attempt) * 1000;
                console.warn(`Network error (attempt ${attempt + 1}/${retries}), retrying in ${backoffMs}ms: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
                continue;
            }
        }
    }
    
    throw lastError || new Error('GitHub commit failed after retries');
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
        return jsonResponse({ error: 'KV database not configured. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    // Rate limit (using KV for persistence across worker restarts)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimited = !(await checkRateLimit(db, ip));
    if (rateLimited) {
        return jsonResponse({ error: 'Rate limit exceeded (30 requests/minute). Try again later.' }, 429, env, request);
    }

    try {
        // Validate session
        const authHeader = request.headers.get('Authorization');
        const session = await validateSession(db, authHeader);

        if (!session) {
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }

        // Parse request body
        const { pageId, content, saveAs } = await request.json();

        if (!pageId || !content) {
            return jsonResponse({ error: 'pageId and content required' }, 400, env, request);
        }
        
        // Determine save type: 'draft' or 'direct' (direct for backward compatibility)
        const requestedSaveType = saveAs || 'direct';
        let saveType = requestedSaveType;

        // Sanitize pageId
        const sanitizedPageId = pageId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (sanitizedPageId !== pageId.toLowerCase()) {
            return jsonResponse({ error: 'Invalid pageId format' }, 400, env, request);
        }

        // Content size validation
        // Serialize content and check size BEFORE encoding
        const contentStr = JSON.stringify(content);
        const MAX_SIZE = 1024 * 1024; // 1MB
        
        if (contentStr.length > MAX_SIZE) {
            const sizeMB = (contentStr.length / (1024 * 1024)).toFixed(2);
            return jsonResponse({
                error: 'Content exceeds 1MB limit',
                current: `${sizeMB}MB`,
                max: '1MB',
                suggestion: 'Reduce content size or split into multiple pages'
            }, 413, env, request);
        }
        
        // Also validate encoded size (Base64 expands content by ~33%)
        const encodedSize = btoa(unescape(encodeURIComponent(contentStr))).length;
        if (encodedSize > MAX_SIZE) {
            return jsonResponse({
                error: 'Encoded content exceeds 1MB limit (Base64 expansion)',
                raw: `${(contentStr.length / (1024 * 1024)).toFixed(2)}MB`,
                encoded: `${(encodedSize / (1024 * 1024)).toFixed(2)}MB`
            }, 413, env, request);
        }

        // Fetch existing file
        const filePath = `data/${sanitizedPageId}/content.json`;
        const existing = await fetchGitHubFile(env, filePath);

        // RBAC check
        const permission = canUserEdit(session, existing.content);
        if (!permission.allowed) {
            return jsonResponse({ error: permission.reason }, 403, env, request);
        }

        // Enforce draft-only saves for contributors
        if (session.role === 'contributor' && saveType !== 'draft') {
            saveType = 'draft';
        }

        // Prepare content structure with draft/published workflow
        const existingData = existing.content || {};
        const finalContent = {};

        // Preserve existing structure
        if (existingData.draft) finalContent.draft = existingData.draft;
        if (existingData.published) finalContent.published = existingData.published;

        // Save to appropriate location
        if (saveType === 'draft') {
            // Save as draft
            finalContent.draft = content;
        } else {
            // Direct save (backward compatibility): update both draft and published
            finalContent.draft = content;
            finalContent.published = content;
        }

        // Metadata
        finalContent._meta = { ...(existingData._meta || {}) };
        finalContent._meta.status = saveType === 'draft' ? 'draft' : 'published';
        finalContent._meta.modifiedBy = session.username;
        finalContent._meta.lastModified = new Date().toISOString();

        if (!existing.exists || !existingData._meta?.createdBy) {
            // New content: set creator
            finalContent._meta.createdBy = session.username;
            finalContent._meta.created = new Date().toISOString();
        } else {
            // Existing content: preserve creator
            finalContent._meta.createdBy = existingData._meta.createdBy;
            finalContent._meta.created = existingData._meta.created;
        }

        const commitMessage = saveType === 'draft'
            ? `Save draft: ${sanitizedPageId} by ${session.username}`
            : `Update ${sanitizedPageId} by ${session.username} (${session.role})`;
        const sha = await commitToGitHub(env, filePath, finalContent, commitMessage, existing.sha);

        // Audit log
        await logAudit(db, saveType === 'draft' ? 'content_save_draft' : 'content_save', session.username, {
            pageId: sanitizedPageId,
            commit: sha,
            saveType
        });

        return jsonResponse({
            success: true,
            commit: sha,
            pageId: sanitizedPageId,
            modifiedBy: session.username,
            status: finalContent._meta.status,
            saveType
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Save');
        return jsonResponse({ error: 'Save failed' }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
