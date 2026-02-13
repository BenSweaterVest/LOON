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
import { logError, jsonResponse } from './_response.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };
const ALLOWED = new Set(['draft', 'in_review', 'approved', 'scheduled', 'published']);

function sanitizePageId(pageId) {
    const normalized = String(pageId || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,50}$/.test(normalized)) return null;
    return normalized;
}

async function validateSession(db, request) {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    const raw = await db.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw);
}

async function githubRequest(env, path, init = {}) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/${path}`;
    return fetch(url, {
        ...init,
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS/1.0',
            ...init.headers
        }
    });
}

async function getContentFile(env, pageId) {
    const path = `data/${pageId}/content.json`;
    const res = await githubRequest(env, `contents/${path}`);
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`GitHub read failed (${res.status})`);
    }
    const data = await res.json();
    return { sha: data.sha, path, content: JSON.parse(atob(data.content)) };
}

async function putContentFile(env, path, content, sha, message) {
    const body = {
        message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        sha
    };
    const res = await githubRequest(env, `contents/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GitHub write failed (${res.status}): ${txt}`);
    }
    const data = await res.json();
    return data.commit?.sha || null;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.LOON_DB || env.KV;

    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const session = await validateSession(db, request);
        if (!session) return jsonResponse({ error: 'Authentication required' }, 401, env, request);
        if (session.role !== 'admin' && session.role !== 'editor') {
            return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);
        }

        const body = await request.json();
        const pageId = sanitizePageId(body.pageId);
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

        return jsonResponse({ success: true, pageId, status, scheduledFor, commit }, 200, env, request);
    } catch (err) {
        logError(err, 'Workflow/Post', env);
        return jsonResponse({ error: 'Failed to update workflow status' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
