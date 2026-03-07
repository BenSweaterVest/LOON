/**
 * ============================================================================
 * LOON Watch Endpoint (functions/api/watch.js)
 * ============================================================================
 *
 * Manage per-user page watchlists and return recent watched page activity.
 *
 * ENDPOINTS:
 *   GET    /api/watch
 *   POST   /api/watch   body: { pageId }
 *   DELETE /api/watch   body: { pageId }
 */

import { handleCorsOptions } from './_cors.js';
import { getAuditLogs, getAuditLogsForPage } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import {
    addWatchPageToIndex,
    getWatchPagesFromIndex,
    removeWatchPageFromIndex
} from '../lib/kv-index.js';
import { getStrictPageId } from '../lib/page-id.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';

const CORS_OPTIONS = { methods: 'GET, POST, DELETE, OPTIONS' };

async function listWatchedPages(db, username) {
    return getWatchPagesFromIndex(db, username);
}

async function watchedRecentChanges(db, watchedPages, limit = 30) {
    if (!watchedPages.length) return [];
    const pageLogSets = await Promise.all(
        watchedPages.map(pageId => getAuditLogsForPage(db, pageId, 20))
    );
    const logs = pageLogSets.flat();

    // Backward-compatible fallback if page feeds are not populated yet.
    if (!logs.length) {
        const allLogs = await getAuditLogs(db, { limit: 600 });
        const set = new Set(watchedPages);
        return allLogs
            .filter(log => set.has(log?.details?.pageId))
            .slice(0, limit)
            .map(log => ({
                action: log.action,
                pageId: log.details?.pageId || null,
                username: log.username,
                timestamp: log.timestamp,
                details: log.details || {}
            }));
    }

    return logs
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit)
        .map(log => ({
            action: log.action,
            pageId: log.details?.pageId || null,
            username: log.username,
            timestamp: log.timestamp,
            details: log.details || {}
        }));
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);

    try {
        const token = getBearerToken(request);
        if (!token) return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        const session = await getSessionFromRequest(db, request);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        const watchedPages = await listWatchedPages(db, session.username);
        const recent = await watchedRecentChanges(db, watchedPages, 30);
        return jsonResponse({ watchedPages, recent }, 200, env, request);
    } catch (err) {
        logError(err, 'Watch/Get', env);
        return jsonResponse({ error: 'Failed to load watchlist' }, 500, env, request);
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    try {
        const token = getBearerToken(request);
        if (!token) return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        const session = await getSessionFromRequest(db, request);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        const body = await request.json();
        const pageId = getStrictPageId(body.pageId, { min: 3, max: 50, trim: true });
        if (!pageId) return jsonResponse({ error: 'Valid pageId required' }, 400, env, request);
        await db.put(`watch:${session.username}:${pageId}`, JSON.stringify({ watchedAt: Date.now() }));
        await addWatchPageToIndex(db, session.username, pageId);
        return jsonResponse({ success: true, pageId }, 200, env, request);
    } catch (err) {
        logError(err, 'Watch/Post', env);
        return jsonResponse({ error: 'Failed to watch page' }, 500, env, request);
    }
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    try {
        const token = getBearerToken(request);
        if (!token) return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        const session = await getSessionFromRequest(db, request);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        const body = await request.json();
        const pageId = getStrictPageId(body.pageId, { min: 3, max: 50, trim: true });
        if (!pageId) return jsonResponse({ error: 'Valid pageId required' }, 400, env, request);
        await db.delete(`watch:${session.username}:${pageId}`);
        await removeWatchPageFromIndex(db, session.username, pageId);
        return jsonResponse({ success: true, pageId }, 200, env, request);
    } catch (err) {
        logError(err, 'Watch/Delete', env);
        return jsonResponse({ error: 'Failed to unwatch page' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
