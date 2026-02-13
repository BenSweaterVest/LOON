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
import { logError, jsonResponse } from './_response.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

async function validateSession(db, request) {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    const raw = await db.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw);
}

async function github(env, path, init = {}) {
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

async function listPageIds(env, limit = 150) {
    const res = await github(env, 'contents/data');
    if (!res.ok) return [];
    const data = await res.json();
    return data
        .filter(item => item.type === 'dir')
        .map(item => item.name)
        .slice(0, limit);
}

async function readPageContent(env, pageId) {
    const path = `data/${pageId}/content.json`;
    const res = await github(env, `contents/${path}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { path, sha: data.sha, content: JSON.parse(atob(data.content)) };
}

async function writePageContent(env, page, content, actor) {
    const payload = {
        message: `Scheduled publish ${page.path} by ${actor}`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        sha: page.sha
    };
    const res = await github(env, `contents/${page.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Failed publish ${page.path}: ${res.status} ${txt}`);
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
        if (session.role !== 'admin' && session.role !== 'editor') return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);

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

