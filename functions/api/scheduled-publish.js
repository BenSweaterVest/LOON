/**
 * ============================================================================
 * LOON Scheduled Publish Runner (functions/api/scheduled-publish.js)
 * ============================================================================
 *
 * Executes pending scheduled publishes.
 *
 * ENDPOINT: POST /api/scheduled-publish
 * Roles: admin/editor
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson, listRepoDirectory, putRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

async function listPageIds(env, limit = 150) {
    const data = await listRepoDirectory(env, 'data');
    if (!data) return [];
    return data
        .filter(item => item.type === 'dir')
        .map(item => item.name)
        .slice(0, limit);
}

async function readPageContent(env, pageId) {
    const path = `data/${pageId}/content.json`;
    const file = await getRepoFileJson(env, path);
    if (!file.exists) return null;
    return { path, sha: file.sha, content: file.content };
}

async function writePageContent(env, page, content, actor) {
    return putRepoFileJson(env, page.path, content, `Scheduled publish ${page.path} by ${actor}`, page.sha, { pretty: true });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/scheduled-publish', 'anonymous');
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const token = getBearerToken(request);
        if (!token) {
            logSecurityEvent({
                ...security,
                event: 'scheduled_publish_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }
        const session = await getSessionFromRequest(db, request);
        if (!session) {
            logSecurityEvent({
                ...security,
                event: 'scheduled_publish_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }
        security.actor = session.username;
        if (session.role !== 'admin' && session.role !== 'editor') {
            logSecurityEvent({
                ...security,
                event: 'scheduled_publish_permission_denied',
                outcome: 'denied',
                details: { role: session.role }
            }, env);
            return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);
        }

        const now = Date.now();
        const pageIds = await listPageIds(env, 200);
        const published = [];
        const skipped = [];

        for (const pageId of pageIds) {
            const page = await readPageContent(env, pageId);
            if (!page || !page.content?._meta) continue;
            const meta = page.content._meta;
            const status = meta.workflowStatus || meta.status;
            if (status !== 'scheduled' || !meta.scheduledFor) continue;

            const due = new Date(meta.scheduledFor).getTime();
            if (Number.isNaN(due) || due > now) {
                skipped.push({ pageId, reason: 'not_due' });
                continue;
            }
            if (!page.content.draft) {
                skipped.push({ pageId, reason: 'no_draft' });
                continue;
            }

            const next = { ...page.content };
            next.published = next.draft;
            next._meta.status = 'published';
            next._meta.workflowStatus = 'published';
            next._meta.publishedAt = new Date().toISOString();
            next._meta.publishedBy = session.username;
            delete next._meta.scheduledFor;

            const commit = await writePageContent(env, page, next, session.username);
            published.push({ pageId, commit });
            await logAudit(db, 'content_scheduled_publish', session.username, { pageId, commit });
            logSecurityEvent({
                ...security,
                event: 'content_scheduled_published',
                outcome: 'allowed',
                details: { pageId, commit }
            }, env);
        }

        return jsonResponse({ success: true, checked: pageIds.length, published, skipped }, 200, env, request);
    } catch (err) {
        logError(err, 'ScheduledPublish/Post', env);
        return jsonResponse({ error: 'Scheduled publish runner failed' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
