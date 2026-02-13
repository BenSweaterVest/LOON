/**
 * ============================================================================
 * LOON History Endpoint (functions/api/history.js)
 * ============================================================================
 *
 * Lists commit history for a page's content file.
 *
 * ENDPOINT: GET /api/history?pageId=<id>&limit=<n>
 *
 * Auth: required (all roles). Contributors may only access pages they own.
 */

import { handleCorsOptions } from './_cors.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';

const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

function sanitizePageId(pageId) {
    const normalized = String(pageId || '').trim().toLowerCase();
    if (!normalized) return null;
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

async function fetchGitHubJson(env, path, extra = '') {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/${path}${extra}`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS/1.0'
        }
    });
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`GitHub request failed (${res.status}): ${body}`);
        err.status = res.status;
        throw err;
    }
    return await res.json();
}

async function getCurrentContent(env, pageId) {
    const filePath = `data/${pageId}/content.json`;
    const data = await fetchGitHubJson(env, `contents/${filePath}`);
    const decoded = JSON.parse(atob(data.content));
    return decoded;
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);

    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    try {
        const session = await validateSession(db, request);
        if (!session) {
            return jsonResponse({ error: 'Authentication required' }, 401, env, request);
        }

        const url = new URL(request.url);
        const pageId = sanitizePageId(url.searchParams.get('pageId'));
        const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

        if (!pageId) {
            return jsonResponse({ error: 'Valid pageId is required' }, 400, env, request);
        }

        const currentContent = await getCurrentContent(env, pageId);
        const createdBy = currentContent?._meta?.createdBy || null;

        if (session.role === 'contributor' && createdBy && createdBy !== session.username) {
            return jsonResponse({ error: 'Contributors can only view history for pages they created' }, 403, env, request);
        }

        const path = encodeURIComponent(`data/${pageId}/content.json`);
        const commits = await fetchGitHubJson(env, `commits`, `?path=${path}&per_page=${limit}`);
        const history = commits.map(entry => ({
            sha: entry.sha,
            message: entry.commit?.message || '',
            date: entry.commit?.author?.date || null,
            author: entry.commit?.author?.name || 'unknown',
            url: entry.html_url || null
        }));

        return jsonResponse({
            pageId,
            total: history.length,
            history
        }, 200, env, request);
    } catch (err) {
        if (err?.status === 404) {
            return jsonResponse({ error: 'Page not found' }, 404, env, request);
        }
        logError(err, 'History/Get', env);
        return jsonResponse({ error: 'Failed to load revision history' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
