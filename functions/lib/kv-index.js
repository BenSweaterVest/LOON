/**
 * Shared KV index helpers to reduce expensive list operations.
 */

const USER_INDEX_KEY = 'meta:index:users';
const SESSION_INDEX_KEY = 'meta:index:sessions';
const SCHEDULED_PAGES_INDEX_KEY = 'meta:index:scheduled_pages';
const USER_SESSION_INDEX_PREFIX = 'meta:index:user_sessions:';
const WATCH_INDEX_PREFIX = 'meta:index:watch:';
const SESSION_META_PREFIX = 'session_meta:';
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const sessionCleanupByDb = new WeakMap();

function sanitizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(v => typeof v === 'string' && v.length > 0))];
}

async function readArrayIndex(db, key) {
    const value = await db.get(key, { type: 'json' });
    if (!value) return null;
    return sanitizeStringArray(value);
}

async function writeArrayIndex(db, key, values, options = {}) {
    const arr = sanitizeStringArray(values);
    const putOptions = {};
    if (Number.isFinite(options.expirationTtl) && options.expirationTtl > 0) {
        putOptions.expirationTtl = Math.floor(options.expirationTtl);
    }
    if (Object.keys(putOptions).length > 0) {
        await db.put(key, JSON.stringify(arr), putOptions);
    } else {
        await db.put(key, JSON.stringify(arr));
    }
    return arr;
}

async function addToArrayIndex(db, key, value, options = {}) {
    if (!value) return [];
    const arr = (await readArrayIndex(db, key)) || [];
    if (!arr.includes(value)) arr.push(value);
    return writeArrayIndex(db, key, arr, options);
}

async function removeFromArrayIndex(db, key, value, options = {}) {
    if (!value) return [];
    const arr = (await readArrayIndex(db, key)) || [];
    return writeArrayIndex(db, key, arr.filter(v => v !== value), options);
}

export function getSessionMetaKey(token) {
    return `${SESSION_META_PREFIX}${token}`;
}

export function getUserSessionIndexKey(username) {
    return `${USER_SESSION_INDEX_PREFIX}${username}`;
}

export function getWatchIndexKey(username) {
    return `${WATCH_INDEX_PREFIX}${username}`;
}

export async function getUsersFromIndex(db) {
    const indexed = await readArrayIndex(db, USER_INDEX_KEY);
    if (indexed) return indexed;

    const list = await db.list({ prefix: 'user:' });
    const usernames = (list?.keys || [])
        .map(k => k.name.replace(/^user:/, ''))
        .filter(Boolean);
    await writeArrayIndex(db, USER_INDEX_KEY, usernames);
    return usernames;
}

export async function addUserToIndex(db, username) {
    return addToArrayIndex(db, USER_INDEX_KEY, username);
}

export async function removeUserFromIndex(db, username) {
    return removeFromArrayIndex(db, USER_INDEX_KEY, username);
}

export async function getWatchPagesFromIndex(db, username) {
    const key = getWatchIndexKey(username);
    const indexed = await readArrayIndex(db, key);
    if (indexed) return indexed;

    const prefix = `watch:${username}:`;
    const list = await db.list({ prefix, limit: 500 });
    const pages = (list?.keys || [])
        .map(k => k.name.slice(prefix.length))
        .filter(Boolean)
        .sort();
    await writeArrayIndex(db, key, pages);
    return pages;
}

export async function addWatchPageToIndex(db, username, pageId) {
    return addToArrayIndex(db, getWatchIndexKey(username), pageId);
}

export async function removeWatchPageFromIndex(db, username, pageId) {
    return removeFromArrayIndex(db, getWatchIndexKey(username), pageId);
}

export async function getSessionTokensFromIndex(db) {
    const indexed = await readArrayIndex(db, SESSION_INDEX_KEY);
    if (indexed) return indexed;

    const list = await db.list({ prefix: 'session:' });
    const tokens = (list?.keys || [])
        .map(k => k.name.replace(/^session:/, ''))
        .filter(Boolean);
    await writeArrayIndex(db, SESSION_INDEX_KEY, tokens);
    return tokens;
}

export async function setSessionTokensIndex(db, tokens) {
    return writeArrayIndex(db, SESSION_INDEX_KEY, tokens);
}

export async function addSessionTokenToIndex(db, token) {
    return addToArrayIndex(db, SESSION_INDEX_KEY, token);
}

export async function removeSessionTokenFromIndex(db, token) {
    return removeFromArrayIndex(db, SESSION_INDEX_KEY, token);
}

export async function getUserSessionTokens(db, username) {
    const key = getUserSessionIndexKey(username);
    const indexed = await readArrayIndex(db, key);
    if (indexed) return indexed;
    return [];
}

export async function addUserSessionToken(db, username, token) {
    return addToArrayIndex(db, getUserSessionIndexKey(username), token);
}

export async function removeUserSessionToken(db, username, token) {
    return removeFromArrayIndex(db, getUserSessionIndexKey(username), token);
}

export async function storeSessionMeta(db, token, sessionData, expirationTtl = 86400) {
    await db.put(getSessionMetaKey(token), JSON.stringify(sessionData), { expirationTtl });
}

export async function getSessionMeta(db, token) {
    return db.get(getSessionMetaKey(token), { type: 'json' });
}

export async function deleteSessionMeta(db, token) {
    await db.delete(getSessionMetaKey(token));
}

export async function indexSession(db, token, sessionData, expirationTtl = 86400) {
    await Promise.all([
        storeSessionMeta(db, token, sessionData, expirationTtl),
        addSessionTokenToIndex(db, token),
        addUserSessionToken(db, sessionData.username, token)
    ]);
}

export async function deindexSession(db, token, username = null) {
    let resolvedUsername = username;
    if (!resolvedUsername) {
        const meta = await getSessionMeta(db, token);
        resolvedUsername = meta?.username || null;
    }

    const tasks = [
        deleteSessionMeta(db, token),
        removeSessionTokenFromIndex(db, token)
    ];
    if (resolvedUsername) {
        tasks.push(removeUserSessionToken(db, resolvedUsername, token));
    }
    await Promise.all(tasks);
}

export async function readScheduledPageIdsIndex(db) {
    return readArrayIndex(db, SCHEDULED_PAGES_INDEX_KEY);
}

export async function getScheduledPageIds(db) {
    const indexed = await readScheduledPageIdsIndex(db);
    return indexed || [];
}

export async function setScheduledPageIdsIndex(db, pageIds) {
    return writeArrayIndex(db, SCHEDULED_PAGES_INDEX_KEY, pageIds);
}

export async function addScheduledPageToIndex(db, pageId) {
    return addToArrayIndex(db, SCHEDULED_PAGES_INDEX_KEY, pageId);
}

export async function removeScheduledPageFromIndex(db, pageId) {
    return removeFromArrayIndex(db, SCHEDULED_PAGES_INDEX_KEY, pageId);
}

export async function cleanupStaleSessionIndex(db, options = {}) {
    const maxChecks = Math.max(1, Math.min(200, Number(options.maxChecks || 40)));
    const now = Date.now();
    const lastCleanup = sessionCleanupByDb.get(db) || 0;
    if (now - lastCleanup < SESSION_CLEANUP_INTERVAL_MS) {
        return { ran: false, checked: 0, removed: 0 };
    }
    sessionCleanupByDb.set(db, now);

    const tokens = await getSessionTokensFromIndex(db);
    if (!tokens.length) {
        return { ran: true, checked: 0, removed: 0 };
    }

    const toCheck = tokens.slice(0, maxChecks);
    const stale = [];
    for (const token of toCheck) {
        const exists = await db.get(`session:${token}`);
        if (!exists) stale.push(token);
    }
    if (!stale.length) {
        return { ran: true, checked: toCheck.length, removed: 0 };
    }

    const staleSet = new Set(stale);
    const remaining = tokens.filter(token => !staleSet.has(token));
    await setSessionTokensIndex(db, remaining);

    await Promise.all(stale.map(async (token) => {
        const meta = await getSessionMeta(db, token);
        await deleteSessionMeta(db, token);
        if (meta?.username) {
            await removeUserSessionToken(db, meta.username, token);
        }
    }));

    return { ran: true, checked: toCheck.length, removed: stale.length };
}
