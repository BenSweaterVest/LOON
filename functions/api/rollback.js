/**
 * ============================================================================
 * LOON Rollback Endpoint (functions/api/rollback.js)
 * ============================================================================
 *
 * Restores a page's content.json to a selected historical commit.
 *
 * ENDPOINT: POST /api/rollback
 * Body: { pageId: string, commitSha: string }
 *
 * Auth: admin/editor only.
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

function sanitizePageId(pageId) {
    const normalized = String(pageId || '').trim().toLowerCase();
    if (!normalized) return null;
    if (!/^[a-z0-9_-]{3,50}$/.test(normalized)) return null;
    return normalized;
}

function isValidSha(value) {
    return /^[a-f0-9]{7,40}$/i.test(String(value || '').trim());
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
    const headers = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LOON-CMS/1.0',
        ...init.headers
    };
    const res = await fetch(url, { ...init, headers });
    return res;
}

async function fetchContentAtRef(env, filePath, ref) {
    const res = await githubRequest(env, `contents/${filePath}?ref=${encodeURIComponent(ref)}`);
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Failed to fetch historical content (${res.status}): ${body}`);
        err.status = res.status;
        throw err;
    }
    const data = await res.json();
    return JSON.parse(atob(data.content));
}

async function fetchCurrentFile(env, filePath) {
    const res = await githubRequest(env, `contents/${filePath}`);
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Failed to fetch current content (${res.status}): ${body}`);
        err.status = res.status;
        throw err;
    }
    return await res.json();
}

async function commitRollback(env, filePath, content, currentSha, actor, fromSha) {
    const body = {
        message: `Rollback ${filePath} to ${fromSha.slice(0, 10)} by ${actor}`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content)))),
        sha: currentSha
    };

    const res = await githubRequest(env, `contents/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Rollback commit failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.commit?.sha || null;
}

export async function onRequestPost(context) {
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
        if (session.role !== 'admin' && session.role !== 'editor') {
            return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);
        }

        const body = await request.json();
        const pageId = sanitizePageId(body.pageId);
        const commitSha = String(body.commitSha || '').trim();

        if (!pageId || !isValidSha(commitSha)) {
            return jsonResponse({ error: 'Valid pageId and commitSha are required' }, 400, env, request);
        }

        const filePath = `data/${pageId}/content.json`;
        const restoredContent = await fetchContentAtRef(env, filePath, commitSha);

        if (!restoredContent._meta) restoredContent._meta = {};
        restoredContent._meta.modifiedBy = session.username;
        restoredContent._meta.lastModified = new Date().toISOString();
        restoredContent._meta.rolledBackFrom = commitSha;

        const currentFile = await fetchCurrentFile(env, filePath);
        const newSha = await commitRollback(env, filePath, restoredContent, currentFile.sha, session.username, commitSha);

        await logAudit(db, 'content_rollback', session.username, {
            pageId,
            fromCommit: commitSha,
            commit: newSha
        });

        return jsonResponse({
            success: true,
            pageId,
            restoredFrom: commitSha,
            commit: newSha
        }, 200, env, request);
    } catch (err) {
        if (err?.status === 404) {
            return jsonResponse({ error: 'Page or revision not found' }, 404, env, request);
        }
        logError(err, 'Rollback/Post', env);
        return jsonResponse({ error: 'Failed to rollback content' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
