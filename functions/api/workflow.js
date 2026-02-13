/**
 * ============================================================================
 * LOON Workflow Endpoint (functions/api/workflow.js)
 * ============================================================================
 *
 * Manage editorial workflow status for a page.
 *
 * ENDPOINT: POST /api/workflow
 * Body: { pageId, status, scheduledFor? }
 *
 * Roles: admin/editor only
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getStrictPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson, putRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };
const ALLOWED = new Set(['draft', 'in_review', 'approved', 'scheduled', 'published']);

async function getContentFile(env, pageId) {
    const path = `data/${pageId}/content.json`;
    const file = await getRepoFileJson(env, path);
    if (!file.exists) {
        return null;
    }
    return { sha: file.sha, path, content: file.content };
}

async function putContentFile(env, path, content, sha, message) {
    return putRepoFileJson(env, path, content, message, sha, { pretty: true });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/workflow', 'anonymous');

    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const token = getBearerToken(request);
        if (!token) {
            logSecurityEvent({
                ...security,
                event: 'workflow_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }
        const session = await getSessionFromRequest(db, request);
        if (!session) {
            logSecurityEvent({
                ...security,
                event: 'workflow_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }
        security.actor = session.username;
        if (session.role !== 'admin' && session.role !== 'editor') {
            logSecurityEvent({
                ...security,
                event: 'workflow_permission_denied',
                outcome: 'denied',
                details: { role: session.role }
            }, env);
            return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);
        }

        const body = await request.json();
        const pageId = getStrictPageId(body.pageId, { min: 3, max: 50, trim: true });
        const status = String(body.status || '').trim();
        const scheduledFor = body.scheduledFor ? String(body.scheduledFor) : null;

        if (!pageId || !ALLOWED.has(status)) {
            return jsonResponse({ error: 'Valid pageId and workflow status are required' }, 400, env, request);
        }
        if (status === 'scheduled' && !scheduledFor) {
            return jsonResponse({ error: 'scheduledFor is required when status is scheduled' }, 400, env, request);
        }
        if (status === 'scheduled' && Number.isNaN(new Date(scheduledFor).getTime())) {
            return jsonResponse({ error: 'scheduledFor must be a valid ISO datetime string' }, 400, env, request);
        }

        const file = await getContentFile(env, pageId);
        if (!file) return jsonResponse({ error: 'Page not found' }, 404, env, request);

        const content = file.content || {};
        if (!content._meta) content._meta = {};
        content._meta.workflowStatus = status;
        content._meta.workflowUpdatedBy = session.username;
        content._meta.workflowUpdatedAt = new Date().toISOString();

        if (status === 'scheduled') {
            content._meta.scheduledFor = scheduledFor;
        } else {
            delete content._meta.scheduledFor;
        }

        // Keep compatibility with existing status semantics.
        if (status === 'published' || status === 'draft') {
            content._meta.status = status;
        }

        const commit = await putContentFile(
            env,
            file.path,
            content,
            file.sha,
            `Workflow: ${pageId} -> ${status} by ${session.username}`
        );

        await logAudit(db, 'content_workflow_update', session.username, {
            pageId,
            status,
            scheduledFor: scheduledFor || null,
            commit
        });
        logSecurityEvent({
            ...security,
            event: 'workflow_updated',
            outcome: 'allowed',
            details: { pageId, status, scheduledFor: scheduledFor || null, commit }
        }, env);

        return jsonResponse({ success: true, pageId, status, scheduledFor, commit }, 200, env, request);
    } catch (err) {
        logError(err, 'Workflow/Post', env);
        return jsonResponse({ error: 'Failed to update workflow status' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
