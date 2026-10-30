/**
 * Thin client for the LOON API. Session cookies travel automatically.
 */

export class ApiError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }

    get code() {
        return this.details && !Array.isArray(this.details) ? this.details.code : undefined;
    }
}

const listeners = new Set();

/** Subscribe to auth problems: 'signed-out' or 'password-change'. */
export function onAuthEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export async function api(method, path, body, { raw = false, headers = {}, quiet = false } = {}) {
    const init = { method, headers: { ...headers }, credentials: 'same-origin' };
    if (body !== undefined) {
        if (raw) {
            init.body = body;
        } else {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
    }
    let res;
    try {
        res = await fetch(path, init);
    } catch {
        throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
    }
    const text = await res.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
    }
    if (res.ok) return data;

    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new ApiError(res.status, message, data && data.details);
    if (!quiet) {
        if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/passkeys/login')) {
            listeners.forEach((fn) => fn('signed-out'));
        }
        if (err.code === 'password_change_required') listeners.forEach((fn) => fn('password-change'));
    }
    throw err;
}

export const get = (path, opts) => api('GET', path, undefined, opts);
export const post = (path, body, opts) => api('POST', path, body ?? {}, opts);
export const put = (path, body, opts) => api('PUT', path, body ?? {}, opts);
export const patch = (path, body, opts) => api('PATCH', path, body ?? {}, opts);
export const del = (path, body, opts) => api('DELETE', path, body, opts);

/** Human-readable list of validation problems from an ApiError. */
export function errorLines(err) {
    if (Array.isArray(err?.details)) {
        return err.details.map((d) => (typeof d === 'string' ? d : d.message)).filter(Boolean);
    }
    return [];
}
