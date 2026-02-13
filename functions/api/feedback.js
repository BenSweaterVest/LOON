/**
 * ============================================================================
 * LOON Feedback Endpoint (functions/api/feedback.js)
 * ============================================================================
 *
 * Accept and store user feedback from public pages.
 *
 * ENDPOINT:
 *   POST /api/feedback
 *   Body: {
 *     pageId: string (required),
 *     email: string (optional),
 *     message: string (required),
 *     timestamp: string (ISO 8601),
 *     userAgent: string
 *   }
 *
 * RESPONSE:
 *   {
 *     success: true,
 *     message: "Feedback received",
 *     id: "feedback_1234567890_abc123"
 *   }
 */

import { handleCorsOptions } from './_cors.js';
import { jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };
const RATE_LIMIT = { maxAttempts: 10, windowMs: 60000 }; // 10 submissions/minute per IP

function sanitizePageId(input) {
    const value = String(input || '').trim().toLowerCase();
    return /^[a-z0-9_-]{1,100}$/.test(value) ? value : '';
}

function normalizeTimestamp(input) {
    if (!input) return new Date().toISOString();
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function checkRateLimit(db, ip) {
    if (!db) return true;

    const now = Date.now();
    const key = `ratelimit:feedback:${ip}`;

    try {
        const stored = await db.get(key);
        const attempts = stored ? JSON.parse(stored) : [];
        const recent = attempts.filter(ts => now - ts < RATE_LIMIT.windowMs);

        if (recent.length >= RATE_LIMIT.maxAttempts) {
            return false;
        }

        recent.push(now);
        await db.put(key, JSON.stringify(recent), {
            expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000)
        });
        return true;
    } catch {
        return true;
    }
}

/**
 * Handle CORS preflight
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * Handle feedback submission
 */
export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const feedback = await request.json();
        const pageId = sanitizePageId(feedback.pageId);
        const trimmedMessage = String(feedback.message || '').trim();
        const db = getKVBinding(env);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

        // Validate required fields
        if (!pageId) {
            return jsonResponse({ error: 'Invalid pageId format' }, 400, env, request);
        }
        if (!trimmedMessage) {
            return jsonResponse({ error: 'Invalid or missing message' }, 400, env, request);
        }

        // Sanitize inputs
        const sanitized = {
            pageId,
            email: feedback.email ? String(feedback.email).trim().slice(0, 255) : null,
            message: trimmedMessage.slice(0, 5000),
            timestamp: normalizeTimestamp(feedback.timestamp),
            userAgent: feedback.userAgent ? String(feedback.userAgent).slice(0, 500) : null
        };

        // Validate email if provided
        if (sanitized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized.email)) {
            return jsonResponse({ error: 'Invalid email format' }, 400, env, request);
        }

        if (!(await checkRateLimit(db, ip))) {
            return jsonResponse({ error: 'Too many feedback submissions. Try again later.' }, 429, env, request);
        }

        // Check if KV database is available
        if (!db) {
            console.warn('KV database not configured for feedback storage');
            return jsonResponse({ 
                success: true,
                message: 'Feedback received (note: storage not configured)',
                id: null 
            }, 200, env, request);
        }

        // Generate unique feedback ID
        const feedbackId = `feedback_${crypto.randomUUID()}`;
        
        try {
            // Store in KV for quick access
            const kvKey = `feedback:${sanitized.pageId}:${feedbackId}`;
            await db.put(kvKey, JSON.stringify({
                ...sanitized,
                id: feedbackId,
                ip,
                stored: new Date().toISOString()
            }), {
                expirationTtl: 60 * 60 * 24 * 180  // 180 day retention
            });
        } catch (e) {
            console.error('Failed to store feedback in KV:', e);
            // Don't fail the request - feedback was accepted even if storage failed
        }

        return jsonResponse({
            success: true,
            message: 'Feedback received',
            id: feedbackId
        }, 200, env, request);

    } catch (e) {
        console.error('Feedback endpoint error:', e);
        const message = e instanceof SyntaxError ? 'Invalid JSON body' : 'Failed to process feedback';
        return jsonResponse({ error: message }, 400, env, request);
    }
}

