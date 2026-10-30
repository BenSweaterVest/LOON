/**
 * HTTP primitives shared by every route: errors, JSON responses, body parsing.
 */

export class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, message);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message, details) => new HttpError(409, message, details);
export const tooMany = (message = 'Too many requests. Try again shortly.') => new HttpError(429, message);

const BASE_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
};

export function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...BASE_HEADERS, ...headers }
    });
}

export function errorResponse(err) {
    const body = { error: err.message };
    if (err.details !== undefined) body.details = err.details;
    return json(body, err.status);
}

/**
 * Read and parse a JSON body, enforcing a byte limit before parsing.
 */
export async function readJson(request, { maxBytes = 256 * 1024 } = {}) {
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > maxBytes) {
        throw new HttpError(413, `Request body exceeds ${formatBytes(maxBytes)}`);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
        throw new HttpError(413, `Request body exceeds ${formatBytes(maxBytes)}`);
    }
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not an object');
        }
        return parsed;
    } catch {
        throw badRequest('Request body must be a JSON object');
    }
}

export function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
    return `${Math.round(bytes / 1024)}KB`;
}
