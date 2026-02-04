/**
 * Test Helpers
 * Utilities for testing Cloudflare Workers functions
 */

/**
 * Create a mock Request object
 */
export function createMockRequest(method, body = null, headers = {}) {
    const requestHeaders = new Headers({
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '127.0.0.1',
        ...headers
    });
    
    const init = {
        method,
        headers: requestHeaders
    };
    
    if (body && method !== 'GET') {
        init.body = JSON.stringify(body);
    }
    
    return new Request('http://localhost/api/test', init);
}

/**
 * Create a mock environment object
 */
export function createMockEnv(overrides = {}) {
    return {
        GITHUB_REPO: 'test-user/test-repo',
        GITHUB_TOKEN: 'test-token-12345',
        USER_DEMO_PASSWORD: 'test-password',
        USER_TEST_PASSWORD: 'another-password',
        ...overrides
    };
}

/**
 * Create a mock KV namespace
 */
export function createMockKV() {
    const store = new Map();
    
    return {
        get: async (key, options) => {
            const value = store.get(key);
            if (!value) return null;
            if (options?.type === 'json') {
                return JSON.parse(value);
            }
            return value;
        },
        put: async (key, value, options) => {
            store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
        delete: async (key) => {
            store.delete(key);
        },
        list: async (options) => {
            const prefix = options?.prefix || '';
            const keys = [];
            for (const key of store.keys()) {
                if (key.startsWith(prefix)) {
                    keys.push({ name: key });
                }
            }
            return { keys };
        },
        // Internal helper for tests
        _store: store,
        _clear: () => store.clear()
    };
}

/**
 * Create a mock context object
 */
export function createMockContext(request, env, overrides = {}) {
    return {
        request,
        env,
        ...overrides
    };
}

/**
 * Parse JSON response
 */
export async function parseResponse(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Create a mock database (alias for createMockKV)
 */
export function createMockDB(overrides = {}) {
    const kv = createMockKV();
    return {
        ...kv,
        put: async (key, value, options) => {
            await kv.put(key, value, options);
            return { success: true };
        },
        ...overrides
    };
}

/**
 * Create a mock session object
 */
export function createMockSession(username = 'testuser', role = 'contributor') {
    return {
        token: `token-${Date.now()}`,
        username,
        role,
        created: Date.now(),
        ip: '127.0.0.1',
        expiresIn: 86400 // 24 hours in seconds
    };
}

/**
 * Create a mock response object
 */
export function createMockResponse(status = 200, data = {}, headers = {}) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                ...headers
            }
        }
    );
}
