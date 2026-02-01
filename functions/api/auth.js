/**
 * ============================================================================
 * LOON Auth Endpoint (functions/api/auth.js)
 * ============================================================================
 *
 * This endpoint validates credentials before allowing access to the editor.
 * It's called by admin.html when a user attempts to log in.
 *
 * WHY A SEPARATE AUTH ENDPOINT?
 * The save endpoint also validates passwords, so why have a separate auth
 * endpoint? Two reasons:
 *   1. Better UX: Users find out immediately if their password is wrong,
 *      instead of after editing content
 *   2. Stricter rate limiting: Auth attempts are limited to 10/minute
 *      (vs 30/minute for saves) to prevent brute force attacks
 *
 * ENDPOINT: POST /api/auth
 *
 * REQUEST BODY:
 *   {
 *     "pageId": "demo",         // The page identifier
 *     "password": "secret123"   // The user's password
 *   }
 *
 * RESPONSE CODES:
 *   - 200: Success - credentials are valid
 *   - 400: Bad request - missing fields
 *   - 401: Unauthorized - invalid credentials
 *   - 429: Too many requests - rate limit exceeded
 *   - 500: Server error
 *
 * SECURITY NOTES:
 *   - Rate limited to 10 attempts per minute (stricter than save endpoint)
 *   - Uses timing-safe comparison to prevent timing attacks
 *   - Returns generic error messages to avoid revealing valid page IDs
 *
 * @module functions/api/auth
 * @version 1.0.0 (Phase 1 - Directory Mode)
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for the auth endpoint.
 * Note: Rate limits are stricter here than on /api/save because auth
 * endpoints are common targets for brute force attacks.
 */
const CONFIG = {
  /**
   * Maximum auth attempts per IP within the rate limit window.
   * Default: 10 attempts per minute
   * 
   * This is lower than the save endpoint (30/min) because:
   * - Auth endpoints are prime targets for brute force attacks
   * - Normal users only need to authenticate once per session
   */
  RATE_LIMIT_REQUESTS: 10,
  
  /**
   * Rate limit window duration in milliseconds.
   * Default: 60000ms (1 minute)
   */
  RATE_LIMIT_WINDOW_MS: 60000,
};

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * In-memory storage for rate limit tracking.
 * See save.js for detailed explanation of this approach.
 */
const rateLimitMap = new Map();

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

/**
 * Handles CORS preflight requests.
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 * @param {Object} context - Cloudflare Pages Function context
 * @returns {Response} Empty response with CORS headers
 */
export async function onRequestOptions(context) {
  return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * Main handler for POST /api/auth
 * 
 * Validates a page ID and password combination without performing any
 * write operations. Used by the admin UI to verify credentials before
 * showing the editor.
 * 
 * @param {Object} context - Cloudflare Pages Function context
 * @param {Request} context.request - The incoming HTTP request
 * @param {Object} context.env - Environment variables
 * @returns {Response} JSON response indicating success or failure
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // Helper to get CORS headers for responses
  const getHeaders = () => getCorsHeaders(env, request, CORS_OPTIONS);

  try {
    // ========================================================================
    // STEP 1: Rate Limiting (Strict for auth endpoint)
    // ========================================================================
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Too many login attempts. Try again in 60 seconds.' }),
        { status: 429, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 2: Parse and Validate Request
    // ========================================================================
    const body = await request.json();
    const { pageId, password } = body;

    if (!pageId || !password) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: pageId, password' }),
        { status: 400, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 3: Sanitize Page ID
    // ========================================================================
    // Only allow alphanumeric characters, hyphens, and underscores.
    // This prevents directory traversal and other injection attacks.
    // Note: Pattern must match save.js, save-v2.js, and auth-v2.js for consistency.
    const cleanPageId = pageId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (cleanPageId !== pageId.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'Invalid page ID format' }),
        { status: 400, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 4: Look Up Expected Password
    // ========================================================================
    // Password is stored in an environment variable named USER_{PAGEID}_PASSWORD
    const envKey = `USER_${cleanPageId.toUpperCase()}_PASSWORD`;
    const expectedPassword = env[envKey];

    // SECURITY: Don't reveal whether the page exists
    // Return the same error for "page doesn't exist" and "wrong password"
    if (!expectedPassword) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 5: Timing-Safe Password Comparison
    // ========================================================================
    const isValid = await secureCompare(password, expectedPassword);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 6: Return Success
    // ========================================================================
    // Return the cleaned page ID so the client knows what to use
    return new Response(
      JSON.stringify({ success: true, pageId: cleanPageId }),
      { status: 200, headers: getHeaders() }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Server error', details: err.message }),
      { status: 500, headers: getCorsHeaders(env, request, CORS_OPTIONS) }
    );
  }
}

// ============================================================================
// SECURITY UTILITIES
// ============================================================================

/**
 * Performs a timing-safe string comparison.
 * See save.js for detailed documentation on timing attacks and prevention.
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {Promise<boolean>} True if equal
 */
async function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Handle length mismatch with constant-time behavior
  if (aBytes.length !== bBytes.length) {
    try {
      await crypto.subtle.timingSafeEqual(aBytes, aBytes);
    } catch (e) {
      // Fallback for environments without timingSafeEqual
    }
    return false;
  }

  try {
    return await crypto.subtle.timingSafeEqual(aBytes, bBytes);
  } catch (e) {
    // Fallback for older environments
    return a === b;
  }
}

/**
 * Sliding window rate limiter for auth attempts.
 * See save.js for detailed documentation.
 * 
 * @param {string} clientIP - Client's IP address
 * @returns {boolean} True if request allowed, false if rate limited
 */
function checkRateLimit(clientIP) {
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;
  
  let entry = rateLimitMap.get(clientIP);
  
  if (!entry) {
    entry = { requests: [] };
    rateLimitMap.set(clientIP, entry);
  }
  
  // Remove expired timestamps
  entry.requests = entry.requests.filter(time => time > windowStart);
  
  // Check limit
  if (entry.requests.length >= CONFIG.RATE_LIMIT_REQUESTS) {
    return false;
  }
  
  // Record request
  entry.requests.push(now);
  
  // Periodic cleanup (1% chance per request)
  if (Math.random() < 0.01) {
    for (const [ip, e] of rateLimitMap.entries()) {
      if (e.requests.every(time => time < windowStart)) {
        rateLimitMap.delete(ip);
      }
    }
  }
  
  return true;
}
