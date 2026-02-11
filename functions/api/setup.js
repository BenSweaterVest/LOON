/**
 * ============================================================================
 * LOON Initial Setup Endpoint (functions/api/setup.js)
 * ============================================================================
 *
 * One-time first-admin setup flow:
 * - GET  /api/setup  -> Check if initial setup is required
 * - POST /api/setup  -> Create first admin (requires SETUP_TOKEN)
 *
 * Security model:
 * - Setup is only allowed when no admin user exists
 * - Requires high-entropy SETUP_TOKEN secret from environment
 * - Password is hashed before storage (no plaintext in KV)
 * - Returns a session token for immediate login after setup
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { jsonResponse, logError } from './_response.js';

const CORS_OPTIONS = { methods: 'GET, POST, OPTIONS' };
const RATE_LIMIT = { maxAttempts: 10, windowMs: 60000 };

function normalizeUsername(username) {
    if (!username || typeof username !== 'string') return null;
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (sanitized.length < 3 || sanitized.length > 32) return null;
    return sanitized;
}

async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    return btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
}

function timingSafeEqualString(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

async function checkRateLimit(db, ip) {
    const now = Date.now();
    const key = `ratelimit:setup:${ip}`;

    try {
        const stored = await db.get(key);
        const attempts = stored ? JSON.parse(stored) : [];
        const recent = attempts.filter(t => now - t < RATE_LIMIT.windowMs);

        if (recent.length >= RATE_LIMIT.maxAttempts) {
            return false;
        }

        recent.push(now);
        await db.put(key, JSON.stringify(recent), {
            expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000)
        });

        return true;
    } catch (err) {
        logError(err, 'Setup/RateLimit');
        return true;
    }
}

async function adminExists(db) {
    let cursor = undefined;

    do {
        const listOptions = { prefix: 'user:', limit: 1000 };
        if (cursor) listOptions.cursor = cursor;

        const page = await db.list(listOptions);
        const keys = page?.keys || [];

        for (const key of keys) {
            const record = await db.get(key.name, { type: 'json' });
            if (record && record.role === 'admin') {
                return true;
            }
        }

        cursor = page?.cursor;
    } while (cursor);

    return false;
}

export async function onRequestGet(context) {
    const { env, request } = context;
    const db = env.LOON_DB || env.KV;

    if (!db) {
        return jsonResponse(
            { setupRequired: false, setupTokenConfigured: false, error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' },
            500,
            env,
            request
        );
    }

    try {
        const hasAdmin = await adminExists(db);
        return jsonResponse(
            {
                setupRequired: !hasAdmin,
                setupTokenConfigured: !!env.SETUP_TOKEN
            },
            200,
            env,
            request
        );
    } catch (err) {
        logError(err, 'Setup/Status', env);
        return jsonResponse(
            { setupRequired: false, setupTokenConfigured: !!env.SETUP_TOKEN, error: 'Failed to check setup status' },
            500,
            env,
            request
        );
    }
}

export async function onRequestPost(context) {
    const { env, request } = context;
    const db = env.LOON_DB || env.KV;

    if (!db) {
        return jsonResponse({ error: 'KV database not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    if (!env.SETUP_TOKEN) {
        return jsonResponse({ error: 'Initial setup is disabled (SETUP_TOKEN not configured)' }, 503, env, request);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await checkRateLimit(db, ip))) {
        return jsonResponse({ error: 'Too many setup attempts. Try again later.' }, 429, env, request);
    }

    try {
        const hasAdmin = await adminExists(db);
        if (hasAdmin) {
            return jsonResponse({ error: 'Initial setup already completed' }, 409, env, request);
        }

        const body = await request.json();
        const { setupToken, username, password } = body;

        if (!setupToken || !username || !password) {
            return jsonResponse({ error: 'setupToken, username, and password are required' }, 400, env, request);
        }

        if (!timingSafeEqualString(setupToken, env.SETUP_TOKEN)) {
            return jsonResponse({ error: 'Invalid setup token' }, 403, env, request);
        }

        const sanitizedUsername = normalizeUsername(username);
        if (!sanitizedUsername) {
            return jsonResponse({ error: 'Username must be 3-32 characters (letters, numbers, _ -)' }, 400, env, request);
        }

        if (password.length < 8) {
            return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, env, request);
        }

        const existing = await db.get(`user:${sanitizedUsername}`);
        if (existing) {
            return jsonResponse({ error: 'User already exists' }, 409, env, request);
        }

        const salt = crypto.randomUUID();
        const hash = await hashPassword(password, salt);
        const nowIso = new Date().toISOString();

        const userRecord = {
            role: 'admin',
            hash,
            salt,
            created: nowIso,
            createdBy: 'initial-setup',
            passwordSetAt: nowIso
        };

        await db.put(`user:${sanitizedUsername}`, JSON.stringify(userRecord));

        // Create authenticated session so setup can transition directly into app usage.
        const sessionToken = crypto.randomUUID();
        const sessionData = {
            username: sanitizedUsername,
            role: 'admin',
            created: Date.now(),
            ip
        };

        await db.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
            expirationTtl: 86400
        });

        await logAudit(db, 'setup_admin_created', sanitizedUsername, { ip });

        return jsonResponse(
            {
                success: true,
                message: 'Initial admin created successfully',
                token: sessionToken,
                username: sanitizedUsername,
                role: 'admin',
                expiresIn: 86400
            },
            201,
            env,
            request
        );
    } catch (err) {
        logError(err, 'Setup/Create', env);
        return jsonResponse({ error: 'Initial setup failed' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
