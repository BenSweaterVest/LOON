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
import { getAuditLogs } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';

const CORS_OPTIONS = { methods: 'GET, POST, DELETE, OPTIONS' };

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

async function listWatchedPages(db, username) {
    const prefix = `watch:${username}:`;
    const result = await db.list({ prefix, limit: 500 });
    return result.keys
        .map(k => k.name.slice(prefix.length))
        .filter(Boolean)
        .sort();
}

async function watchedRecentChanges(db, watchedPages, limit = 30) {
    if (!watchedPages.length) return [];
    const logs = await getAuditLogs(db, { limit: 600 });
    const set = new Set(watchedPages);
    return logs
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

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);

    try {
        const session = await validateSession(db, request);
        if (!session) return jsonResponse({ error: 'Authentication required' }, 401, env, request);
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
        const session = await validateSession(db, request);
        if (!session) return jsonResponse({ error: 'Authentication required' }, 401, env, request);
        const body = await request.json();
        const pageId = sanitizePageId(body.pageId);
        if (!pageId) return jsonResponse({ error: 'Valid pageId required' }, 400, env, request);
        await db.put(`watch:${session.username}:${pageId}`, JSON.stringify({ watchedAt: Date.now() }));
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
        const session = await validateSession(db, request);
        if (!session) return jsonResponse({ error: 'Authentication required' }, 401, env, request);
        const body = await request.json();
        const pageId = sanitizePageId(body.pageId);
        if (!pageId) return jsonResponse({ error: 'Valid pageId required' }, 400, env, request);
        await db.delete(`watch:${session.username}:${pageId}`);
        return jsonResponse({ success: true, pageId }, 200, env, request);
    } catch (err) {
        logError(err, 'Watch/Delete', env);
        return jsonResponse({ error: 'Failed to unwatch page' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

