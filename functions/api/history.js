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
import { getStrictPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoApiJson, getRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

async function getCurrentContent(env, pageId) {
    const filePath = `data/${pageId}/content.json`;
    const file = await getRepoFileJson(env, filePath);
    if (!file.exists) {
        const err = new Error('Page not found');
        err.status = 404;
        throw err;
    }
    return file.content;
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
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }

        const session = await getSessionFromRequest(db, request);
        if (!session) {
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }

        const url = new URL(request.url);
        const pageId = getStrictPageId(url.searchParams.get('pageId'), { min: 3, max: 50, trim: true });
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
        const commits = await getRepoApiJson(env, `commits?path=${path}&per_page=${limit}`);
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
