/**
 * Minimal path router. Patterns use `:name` segments, e.g. `/api/pages/:id`.
 */

function compile(pattern) {
    const names = [];
    const source = pattern
        .split('/')
        .map((segment) => {
            if (segment.startsWith(':')) {
                names.push(segment.slice(1));
                return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    return { regex: new RegExp(`^${source}/?$`), names };
}

export class Router {
    constructor() {
        this.routes = [];
    }

    add(method, pattern, handler, options = {}) {
        this.routes.push({ method, pattern, handler, options, ...compile(pattern) });
        return this;
    }

    get(pattern, handler, options) { return this.add('GET', pattern, handler, options); }
    post(pattern, handler, options) { return this.add('POST', pattern, handler, options); }
    put(pattern, handler, options) { return this.add('PUT', pattern, handler, options); }
    patch(pattern, handler, options) { return this.add('PATCH', pattern, handler, options); }
    delete(pattern, handler, options) { return this.add('DELETE', pattern, handler, options); }

    /**
     * Returns `{ route, params }`, `{ allowed }` when the path exists under
     * other methods, or null when nothing matches.
     */
    match(method, pathname) {
        const allowed = [];
        for (const route of this.routes) {
            const m = route.regex.exec(pathname);
            if (!m) continue;
            if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
                allowed.push(route.method);
                continue;
            }
            const params = {};
            route.names.forEach((name, i) => {
                params[name] = decodeURIComponent(m[i + 1]);
            });
            return { route, params };
        }
        return allowed.length ? { allowed } : null;
    }
}
