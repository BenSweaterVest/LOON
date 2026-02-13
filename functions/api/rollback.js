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
import { buildSecurityContext, logError, jsonResponse, logSecurityEvent } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getStrictPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson, putRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

function isValidSha(value) {
    return /^[a-f0-9]{7,40}$/i.test(String(value || '').trim());
}

async function fetchContentAtRef(env, filePath, ref) {
    const file = await getRepoFileJson(env, filePath, { ref });
    if (!file.exists) {
        const err = new Error('Page or revision not found');
        err.status = 404;
        throw err;
    }
    return file.content;
}

async function fetchCurrentFile(env, filePath) {
    const file = await getRepoFileJson(env, filePath);
    if (!file.exists) {
        const err = new Error('Page or revision not found');
        err.status = 404;
        throw err;
    }
    return file;
}

async function commitRollback(env, filePath, content, currentSha, actor, fromSha) {
    return putRepoFileJson(
        env,
        filePath,
        content,
        `Rollback ${filePath} to ${fromSha.slice(0, 10)} by ${actor}`,
        currentSha
    );
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    const security = buildSecurityContext(request, '/api/rollback', 'anonymous');

    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    try {
        const token = getBearerToken(request);
        if (!token) {
            logSecurityEvent({
                ...security,
                event: 'rollback_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }

        const session = await getSessionFromRequest(db, request);
        if (!session) {
            logSecurityEvent({
                ...security,
                event: 'rollback_auth_failed',
                outcome: 'denied'
            }, env);
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }
        security.actor = session.username;
        if (session.role !== 'admin' && session.role !== 'editor') {
            logSecurityEvent({
                ...security,
                event: 'rollback_permission_denied',
                outcome: 'denied',
                details: { role: session.role }
            }, env);
            return jsonResponse({ error: 'Admin or Editor role required' }, 403, env, request);
        }

        const body = await request.json();
        const pageId = getStrictPageId(body.pageId, { min: 3, max: 50, trim: true });
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
        logSecurityEvent({
            ...security,
            event: 'content_rolled_back',
            outcome: 'allowed',
            details: { pageId, fromCommit: commitSha, commit: newSha }
        }, env);

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
