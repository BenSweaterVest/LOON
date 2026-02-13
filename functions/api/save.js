/**
 * Save endpoint (`POST /api/save`).
 * Handles draft/direct saves with RBAC checks and GitHub persistence.
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getUnchangedSanitizedPageId } from '../lib/page-id.js';
import { checkKvRateLimit, buildRateLimitKey } from '../lib/rate-limit.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson, putRepoFileJson } from '../lib/github.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 30, windowMs: 60000 };

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
    const db = getKVBinding(env);

    // Check bindings
    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV. See OPERATIONS.md for setup.' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    // Rate limit (using KV for persistence across worker restarts)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('save', ip), {
            maxAttempts: RATE_LIMIT.maxRequests,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Save/RateLimit');
    }
    if (!rateLimitOk) {
        return jsonResponse({ error: 'Rate limit exceeded (30 requests/minute). Try again later.' }, 429, env, request);
    }

    try {
        // Validate session
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }

        const session = await getSessionFromRequest(db, request);

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
        const sanitizedPageId = getUnchangedSanitizedPageId(pageId);
        if (!sanitizedPageId) {
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
        const existing = await getRepoFileJson(env, filePath);

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
        const sha = await putRepoFileJson(env, filePath, finalContent, commitMessage, existing.sha, { retries: 2 });

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
