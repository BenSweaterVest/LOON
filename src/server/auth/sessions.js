/**
 * Cookie sessions. The browser holds a random token in an HttpOnly cookie;
 * D1 stores only its SHA-256, so a database leak does not leak sessions.
 */

import { all, first, run } from '../db/index.js';
import { randomToken, sha256Hex } from '../crypto.js';

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function cookieName(config) {
    return config.environment === 'development' ? 'loon_session' : '__Host-loon_session';
}

function serializeCookie(config, value, maxAge) {
    const parts = [`${cookieName(config)}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
    if (config.environment !== 'development') parts.push('Secure');
    return parts.join('; ');
}

function readCookie(request, name) {
    const header = request.headers.get('Cookie') || '';
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;
        if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
}

export function toUser(row) {
    return {
        username: row.username,
        displayName: row.display_name || row.username,
        role: row.role,
        mustChangePassword: !!row.must_change_password
    };
}

export async function createSession(ctx, username, method = 'password') {
    const now = Date.now();
    const token = randomToken(32);
    const id = await sha256Hex(token);
    const ttl = ctx.config.sessionTtlSeconds;
    await ctx.db.batch([
        ctx.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        ctx.db.prepare(
            `INSERT INTO sessions (id, username, method, created_at, expires_at, last_seen_at, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, username, method, now, now + ttl * 1000, now, ctx.ip, (ctx.request.headers.get('User-Agent') || '').slice(0, 200))
    ]);
    ctx.cookies.push(serializeCookie(ctx.config, token, ttl));
    return { id, expiresAt: now + ttl * 1000 };
}

export async function loadSession(ctx) {
    const token = readCookie(ctx.request, cookieName(ctx.config));
    if (!token || token.length > 100) return null;
    const id = await sha256Hex(token);
    const now = Date.now();
    const row = await first(
        ctx.db,
        `SELECT s.id, s.method, s.created_at, s.expires_at, s.last_seen_at,
                u.username, u.display_name, u.role, u.must_change_password
         FROM sessions s JOIN users u ON u.username = s.username
         WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
        id, now
    );
    if (!row) return null;
    if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
        ctx.waitUntil(run(ctx.db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', now, id));
    }
    return {
        user: toUser(row),
        session: { id: row.id, method: row.method, createdAt: row.created_at, expiresAt: row.expires_at }
    };
}

export async function destroyCurrentSession(ctx) {
    if (ctx.session) await run(ctx.db, 'DELETE FROM sessions WHERE id = ?', ctx.session.id);
    ctx.cookies.push(serializeCookie(ctx.config, '', 0));
}

export async function destroyUserSessions(db, username, { exceptId = null } = {}) {
    if (exceptId) {
        return run(db, 'DELETE FROM sessions WHERE username = ? AND id != ?', username, exceptId);
    }
    return run(db, 'DELETE FROM sessions WHERE username = ?', username);
}

export async function listSessions(db, { username = null } = {}) {
    const now = Date.now();
    const sql = `SELECT id, username, method, created_at, expires_at, last_seen_at, ip, user_agent
                 FROM sessions WHERE expires_at > ? ${username ? 'AND username = ?' : ''}
                 ORDER BY last_seen_at DESC LIMIT 200`;
    return username ? all(db, sql, now, username) : all(db, sql, now);
}
