/**
 * Shared bearer-token session helpers for KV-backed auth.
 */

export function getBearerToken(request) {
    const auth = request?.headers?.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
        return null;
    }
    const token = auth.slice(7).trim();
    return token || null;
}

export async function getSessionFromRequest(db, request) {
    if (!db || !request) return null;
    const token = getBearerToken(request);
    if (!token) return null;
    const raw = await db.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw);
}
