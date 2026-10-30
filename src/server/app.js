/**
 * Request pipeline for every /api/* call:
 * route match -> CSRF origin check -> migrations -> session -> role gate -> handler.
 */

import { getConfig } from './config.js';
import { getDb, migrate } from './db/index.js';
import { HttpError, errorResponse, json, forbidden, unauthorized } from './http.js';
import { loadSession } from './auth/sessions.js';
import { hasRole } from './auth/rbac.js';
import { buildRouter } from './routes/index.js';

let router = null;

function getRouter() {
    if (!router) router = buildRouter();
    return router;
}

function isSameOrigin(request, url) {
    const origin = request.headers.get('Origin');
    if (origin) return origin === url.origin;
    // Browsers always send Origin on cross-site state-changing requests;
    // fall back to Fetch Metadata when it is missing.
    const site = request.headers.get('Sec-Fetch-Site');
    return !site || site === 'same-origin' || site === 'none';
}

function finalize(response, ctx) {
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    for (const cookie of ctx.cookies) headers.append('Set-Cookie', cookie);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handle(request, env = {}, executionCtx = {}) {
    const url = new URL(request.url);
    const ctx = {
        request,
        env,
        url,
        query: url.searchParams,
        params: {},
        config: getConfig(env),
        ip: request.headers.get('CF-Connecting-IP') || '',
        cookies: [],
        user: null,
        session: null,
        waitUntil: (promise) => {
            if (typeof executionCtx.waitUntil === 'function') executionCtx.waitUntil(promise);
        }
    };

    try {
        const match = getRouter().match(request.method, url.pathname);
        if (!match) throw new HttpError(404, 'Not found');
        if (match.allowed) {
            return finalize(json({ error: 'Method not allowed' }, 405, { Allow: match.allowed.join(', ') }), ctx);
        }

        const { route, params } = match;
        const options = route.options;
        ctx.params = params;

        const safeMethod = request.method === 'GET' || request.method === 'HEAD';
        if (!safeMethod && options.csrf !== false && !isSameOrigin(request, url)) {
            throw forbidden('Cross-origin request rejected');
        }

        ctx.db = getDb(env);
        await migrate(ctx.db);

        if (options.auth || options.session === 'optional') {
            const loaded = await loadSession(ctx);
            if (loaded) {
                ctx.user = loaded.user;
                ctx.session = loaded.session;
            }
        }
        if (options.auth) {
            if (!ctx.user) throw unauthorized();
            if (!hasRole(ctx.user, options.auth)) throw forbidden();
            if (ctx.user.mustChangePassword && !options.allowPasswordChangePending) {
                throw new HttpError(403, 'Password change required', { code: 'password_change_required' });
            }
        }

        const result = await route.handler(ctx);
        const response = result instanceof Response ? result : json(result ?? { ok: true });
        return finalize(response, ctx);
    } catch (err) {
        if (err instanceof HttpError) return finalize(errorResponse(err), ctx);
        console.error(JSON.stringify({ level: 'error', path: url.pathname, message: err?.message, stack: err?.stack }));
        return finalize(json({ error: 'Internal error' }, 500), ctx);
    }
}
