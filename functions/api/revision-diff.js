/**
 * ============================================================================
 * LOON Revision Diff Endpoint (functions/api/revision-diff.js)
 * ============================================================================
 *
 * Returns line-by-line diff between two revisions of page content.
 *
 * ENDPOINT: GET /api/revision-diff?pageId=<id>&from=<sha|HEAD>&to=<sha|HEAD>
 */

import { handleCorsOptions } from './_cors.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getStrictPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

function sanitizeRef(ref) {
    const value = String(ref || 'HEAD').trim();
    if (value === 'HEAD') return 'HEAD';
    if (/^[a-f0-9]{7,40}$/i.test(value)) return value;
    return null;
}

async function githubGet(env, path, ref = 'HEAD') {
    const file = await getRepoFileJson(env, path, { ref });
    if (!file.exists) {
        const err = new Error('Page or revision not found');
        err.status = 404;
        throw err;
    }
    return file;
}

function buildLineDiff(fromText, toText) {
    const fromLines = fromText.split('\n');
    const toLines = toText.split('\n');
    const maxLen = Math.max(fromLines.length, toLines.length);
    const rows = [];

    for (let i = 0; i < maxLen; i++) {
        const a = fromLines[i];
        const b = toLines[i];
        if (a === b) {
            rows.push({ type: 'same', line: b ?? '' });
        } else {
            if (a !== undefined) rows.push({ type: 'remove', line: a });
            if (b !== undefined) rows.push({ type: 'add', line: b });
        }
    }
    return rows;
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const token = getBearerToken(request);
        if (!token) return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        const session = await getSessionFromRequest(db, request);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);

        const url = new URL(request.url);
        const pageId = getStrictPageId(url.searchParams.get('pageId'), { min: 3, max: 50, trim: true });
        const fromRef = sanitizeRef(url.searchParams.get('from'));
        const toRef = sanitizeRef(url.searchParams.get('to') || 'HEAD');
        if (!pageId || !fromRef || !toRef) return jsonResponse({ error: 'Valid pageId, from, and to refs are required' }, 400, env, request);

        const filePath = `data/${pageId}/content.json`;
        const head = await githubGet(env, filePath, 'HEAD');
        const headContent = head.content;
        const createdBy = headContent?._meta?.createdBy || null;
        if (session.role === 'contributor' && createdBy && createdBy !== session.username) {
            return jsonResponse({ error: 'Contributors can only diff pages they created' }, 403, env, request);
        }

        const fromData = await githubGet(env, filePath, fromRef);
        const toData = await githubGet(env, filePath, toRef);

        const fromText = JSON.stringify(fromData.content, null, 2);
        const toText = JSON.stringify(toData.content, null, 2);
        const diff = buildLineDiff(fromText, toText);

        return jsonResponse({
            pageId,
            from: fromRef,
            to: toRef,
            diff,
            summary: {
                added: diff.filter(d => d.type === 'add').length,
                removed: diff.filter(d => d.type === 'remove').length,
                unchanged: diff.filter(d => d.type === 'same').length
            }
        }, 200, env, request);
    } catch (err) {
        if (err?.status === 404) {
            return jsonResponse({ error: 'Page or revision not found' }, 404, env, request);
        }
        logError(err, 'RevisionDiff/Get', env);
        return jsonResponse({ error: 'Failed to build revision diff' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
