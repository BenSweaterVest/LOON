/**
 * ============================================================================
 * LOON Save Endpoint (functions/api/save.js)
 * ============================================================================
 *
 * This is the core "write" endpoint for Project LOON. It handles:
 *   1. Rate limiting to prevent abuse
 *   2. Authentication (password verification)
 *   3. Authorization (ensuring users can only edit their own content)
 *   4. Committing content to GitHub via the GitHub API
 *
 * ENDPOINT: POST /api/save
 *
 * REQUEST BODY:
 *   {
 *     "pageId": "demo",           // The page identifier (e.g., "demo", "tacos")
 *     "password": "secret123",    // The user's password
 *     "content": { ... }          // The JSON content to save
 *   }
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   - GITHUB_TOKEN: A GitHub Personal Access Token with write access to the repo
 *   - GITHUB_REPO: The repository in "owner/repo-name" format
 *   - USER_{PAGEID}_PASSWORD: One password per page (e.g., USER_DEMO_PASSWORD)
 *
 * RESPONSE CODES:
 *   - 200: Success - content saved to GitHub
 *   - 400: Bad request - missing or invalid fields
 *   - 401: Unauthorized - invalid password
 *   - 413: Payload too large - content exceeds size limit
 *   - 429: Too many requests - rate limit exceeded
 *   - 500: Server error - GitHub API failure or other error
 *
 * SECURITY FEATURES:
 *   - Timing-safe password comparison (prevents timing attacks)
 *   - Rate limiting per IP address (prevents brute force)
 *   - Content size limits (prevents resource exhaustion)
 *   - Input sanitization (prevents path traversal)
 *
 * ARCHITECTURE NOTES:
 *   - This runs as a Cloudflare Pages Function (similar to Cloudflare Workers)
 *   - Rate limit state is in-memory and resets when the worker restarts
 *   - For high-traffic scenarios, consider using Cloudflare KV for rate limits
 *
 * @module functions/api/save
 * @version 1.0.0 (Phase 1 - Directory Mode)
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration constants for the save endpoint.
 * Adjust these values based on your use case and traffic patterns.
 */
const CONFIG = {
  /**
   * Maximum allowed content size in bytes.
   * Default: 1MB (1,048,576 bytes)
   * 
   * Why 1MB? JSON content for typical pages should be well under this.
   * Larger files may timeout during the GitHub API call.
   */
  MAX_CONTENT_SIZE: 1024 * 1024,
  
  /**
   * Maximum number of save requests allowed per IP within the rate limit window.
   * Default: 30 requests per minute
   * 
   * Why 30? Allows for reasonable editing (save every 2 seconds for a minute)
   * while preventing abuse.
   */
  RATE_LIMIT_REQUESTS: 30,
  
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
 * 
 * Structure: Map<clientIP, { requests: number[] }>
 * - Each IP has an array of timestamps for recent requests
 * 
 * IMPORTANT: This resets when the Cloudflare Worker is restarted.
 * For persistent rate limiting, use Cloudflare KV or Durable Objects.
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
 * Handles CORS preflight requests (OPTIONS method).
 *
 * Browsers send a preflight OPTIONS request before making cross-origin
 * POST requests. This handler responds with the appropriate CORS headers.
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 *
 * @param {Object} context - Cloudflare Pages Function context
 * @returns {Response} Empty response with CORS headers
 */
export async function onRequestOptions(context) {
  return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * Main request handler for POST /api/save
 * 
 * This function orchestrates the entire save flow:
 *   1. Rate limiting check
 *   2. Request validation
 *   3. Authentication (password check)
 *   4. Authorization (file path check)
 *   5. GitHub commit
 * 
 * @param {Object} context - Cloudflare Pages Function context
 * @param {Request} context.request - The incoming HTTP request
 * @param {Object} context.env - Environment variables (secrets)
 * @returns {Response} JSON response indicating success or failure
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // Helper to get CORS headers for responses
  const getHeaders = () => getCorsHeaders(env, request, CORS_OPTIONS);

  try {
    // ========================================================================
    // STEP 1: Rate Limiting
    // ========================================================================
    // Get the client's IP address from Cloudflare's header
    // This is more reliable than request.ip as Cloudflare sits in front
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Check if this IP has exceeded the rate limit
    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again in 60 seconds.' }),
        { status: 429, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 2: Request Validation - Size Check (Pre-parse)
    // ========================================================================
    // Check Content-Length header before parsing to fail fast on oversized requests
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    if (contentLength > CONFIG.MAX_CONTENT_SIZE) {
      return new Response(
        JSON.stringify({ error: 'Content too large', maxSize: CONFIG.MAX_CONTENT_SIZE }),
        { status: 413, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 3: Parse and Validate Request Body
    // ========================================================================
    const body = await request.json();
    const { pageId, password, content } = body;

    // Double-check content size after parsing (in case Content-Length was wrong)
    const contentSize = JSON.stringify(content).length;
    if (contentSize > CONFIG.MAX_CONTENT_SIZE) {
      return new Response(
        JSON.stringify({ error: 'Content too large', maxSize: CONFIG.MAX_CONTENT_SIZE }),
        { status: 413, headers: getHeaders() }
      );
    }

    // Ensure all required fields are present
    if (!pageId || !password || !content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: pageId, password, content' }),
        { status: 400, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 4: Sanitize Page ID
    // ========================================================================
    // Page IDs must be alphanumeric with hyphens and underscores only
    // (e.g., "demo", "food-truck-1", "my_page")
    // This prevents path traversal attacks (e.g., "../../../etc/passwd")
    // Note: Pattern must match auth.js, save-v2.js, and auth-v2.js for consistency.
    const cleanPageId = pageId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (cleanPageId !== pageId.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'Invalid page ID format' }),
        { status: 400, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 5: Authentication - Password Verification
    // ========================================================================
    // Look up the expected password from environment variables
    // Environment variable naming convention: USER_DEMO_PASSWORD, USER_TACOS_PASSWORD, etc.
    const envKey = `USER_${cleanPageId.toUpperCase()}_PASSWORD`;
    const expectedPassword = env[envKey];

    // If no password is configured for this page, reject the request
    // We use a generic error message to avoid revealing which pages exist
    if (!expectedPassword) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: getHeaders() }
      );
    }

    // Use timing-safe comparison to prevent timing attacks
    // (attackers can't determine password correctness by measuring response time)
    const isValid = await secureCompare(password, expectedPassword);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 6: Authorization - File Path Enforcement
    // ========================================================================
    // In "Directory Mode", each user can ONLY edit their own content.json file
    // The file path is derived from the page ID, not user-supplied
    // This ensures users can't edit other users' content
    const allowedFilePath = `data/${cleanPageId}/content.json`;

    // ========================================================================
    // STEP 7: Commit to GitHub
    // ========================================================================
    const commitResult = await commitToGitHub({
      token: env.GITHUB_TOKEN,
      repo: env.GITHUB_REPO,
      filePath: allowedFilePath,
      content: content,
      message: `LOON: Update ${cleanPageId} content`
    });

    if (!commitResult.success) {
      return new Response(
        JSON.stringify({ error: 'GitHub error', details: commitResult.error }),
        { status: 500, headers: getHeaders() }
      );
    }

    // ========================================================================
    // STEP 8: Return Success Response
    // ========================================================================
    return new Response(
      JSON.stringify({ success: true, commit: commitResult.sha }),
      { status: 200, headers: getHeaders() }
    );

  } catch (err) {
    // Catch any unexpected errors and return a generic server error
    return new Response(
      JSON.stringify({ error: 'Server error', details: err.message }),
      { status: 500, headers: getCorsHeaders(env, request, CORS_OPTIONS) }
    );
  }
}

// ============================================================================
// GITHUB API INTEGRATION
// ============================================================================

/**
 * Commits a JSON file to a GitHub repository using the GitHub API.
 * 
 * This function handles both creating new files and updating existing files.
 * For updates, the GitHub API requires the current file's SHA, which we
 * fetch first with a GET request.
 * 
 * API Documentation: https://docs.github.com/en/rest/repos/contents
 * 
 * @param {Object} options - Commit options
 * @param {string} options.token - GitHub Personal Access Token
 * @param {string} options.repo - Repository in "owner/repo" format
 * @param {string} options.filePath - Path to the file within the repo
 * @param {Object} options.content - JSON content to save
 * @param {string} options.message - Commit message
 * @returns {Promise<{success: boolean, sha?: string, error?: string}>}
 */
async function commitToGitHub({ token, repo, filePath, content, message }) {
  const apiBase = 'https://api.github.com';
  
  // Headers required for GitHub API authentication
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Project-LOON/1.0',  // GitHub requires a User-Agent
    'Content-Type': 'application/json'
  };

  try {
    // ------------------------------------------------------------------------
    // STEP 1: Get current file SHA (required for updates)
    // ------------------------------------------------------------------------
    // If the file already exists, we need its SHA to update it
    // If it doesn't exist (404), we'll create a new file
    const getUrl = `${apiBase}/repos/${repo}/contents/${filePath}`;
    const getRes = await fetch(getUrl, { headers });
    
    let sha = null;
    if (getRes.ok) {
      // File exists - extract its SHA for the update
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      // Unexpected error (not "file not found")
      const errText = await getRes.text();
      throw new Error(`GitHub GET failed: ${getRes.status} - ${errText}`);
    }
    // If 404, sha remains null, and we'll create a new file

    // ------------------------------------------------------------------------
    // STEP 2: Encode content as base64
    // ------------------------------------------------------------------------
    // GitHub API requires file content to be base64 encoded
    // We use a UTF-8 safe encoding method to handle special characters
    const jsonString = JSON.stringify(content, null, 2);  // Pretty-print JSON
    const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

    // ------------------------------------------------------------------------
    // STEP 3: Create or update the file
    // ------------------------------------------------------------------------
    // Note: GitHub API rejects requests with "sha": null
    // Only include sha property when updating existing files
    const putBody = {
      message: message,
      content: base64Content,
      ...(sha ? { sha } : {})  // Only include sha for updates, omit for new files
    };

    const putRes = await fetch(getUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub PUT failed: ${putRes.status} - ${errText}`);
    }

    // Return the commit SHA for reference
    const result = await putRes.json();
    return { success: true, sha: result.commit.sha };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// SECURITY UTILITIES
// ============================================================================

/**
 * Performs a timing-safe string comparison to prevent timing attacks.
 * 
 * WHAT IS A TIMING ATTACK?
 * When comparing passwords with regular string comparison (===), the operation
 * short-circuits on the first mismatched character. An attacker can measure
 * response times to determine how many characters they've guessed correctly.
 * 
 * HOW WE PREVENT IT:
 * We use crypto.subtle.timingSafeEqual(), which compares all bytes regardless
 * of whether there's a mismatch, making the operation take constant time.
 * 
 * WHY THE LENGTH CHECK?
 * If strings have different lengths, we still perform a comparison (of the
 * shorter string with itself) to maintain constant time. Otherwise, attackers
 * could determine password length by measuring response time.
 * 
 * @param {string} a - First string to compare
 * @param {string} b - Second string to compare
 * @returns {Promise<boolean>} True if strings are equal, false otherwise
 */
async function secureCompare(a, b) {
  // Type checking
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Convert strings to byte arrays for comparison
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Handle length mismatch with constant-time behavior
  if (aBytes.length !== bBytes.length) {
    // Still perform a comparison to maintain constant time
    try {
      await crypto.subtle.timingSafeEqual(aBytes, aBytes);
    } catch (e) {
      // Fallback for environments without timingSafeEqual
    }
    return false;
  }

  // Perform the actual timing-safe comparison
  try {
    return await crypto.subtle.timingSafeEqual(aBytes, bBytes);
  } catch (e) {
    // Fallback for older environments (less secure but functional)
    return a === b;
  }
}

/**
 * Checks if a request from the given IP should be rate-limited.
 * 
 * This implements a sliding window rate limiter:
 * - Track timestamps of recent requests per IP
 * - Reject if too many requests within the window
 * 
 * LIMITATIONS:
 * - In-memory storage resets when the worker restarts
 * - Distributed workers may have inconsistent state
 * - For production, consider Cloudflare KV or Durable Objects
 * 
 * @param {string} clientIP - The client's IP address
 * @returns {boolean} True if request is allowed, false if rate limited
 */
function checkRateLimit(clientIP) {
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;
  
  // Get or create entry for this IP
  let entry = rateLimitMap.get(clientIP);
  
  if (!entry) {
    entry = { requests: [] };
    rateLimitMap.set(clientIP, entry);
  }
  
  // Remove expired timestamps (outside the current window)
  entry.requests = entry.requests.filter(time => time > windowStart);
  
  // Check if over limit
  if (entry.requests.length >= CONFIG.RATE_LIMIT_REQUESTS) {
    return false;  // Rate limited
  }
  
  // Record this request
  entry.requests.push(now);
  
  // Periodically clean up old entries to prevent memory bloat
  // We do this probabilistically (1% chance) to avoid overhead on every request
  if (Math.random() < 0.01) {
    cleanupRateLimitMap(windowStart);
  }
  
  return true;  // Request allowed
}

/**
 * Removes old entries from the rate limit map to prevent memory bloat.
 * 
 * This is called probabilistically from checkRateLimit() to avoid
 * running on every request.
 * 
 * @param {number} windowStart - Timestamp marking the start of the current window
 */
function cleanupRateLimitMap(windowStart) {
  for (const [ip, entry] of rateLimitMap.entries()) {
    // If all requests from this IP are outside the window, remove the entry
    if (entry.requests.every(time => time < windowStart)) {
      rateLimitMap.delete(ip);
    }
  }
}
