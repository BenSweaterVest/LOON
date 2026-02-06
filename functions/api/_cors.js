/**
 * ============================================================================
 * LOON CORS Utility (functions/api/_cors.js)
 * ============================================================================
 *
 * Shared CORS (Cross-Origin Resource Sharing) configuration for all API
 * endpoints. This module centralizes CORS header generation to ensure
 * consistency across the application.
 *
 * CONFIGURATION:
 *   Set the CORS_ORIGIN environment variable in Cloudflare Pages to restrict
 *   allowed origins. If not set, defaults to '*' (allow all origins).
 *
 *   Examples:
 *     CORS_ORIGIN=https://example.com           - Single origin
 *     CORS_ORIGIN=*                             - All origins (default)
 *
 * SECURITY NOTES:
 *   - For production, set CORS_ORIGIN to your specific domain
 *   - Wildcard (*) is acceptable for public APIs but reduces security
 *   - The Origin header from requests is validated against CORS_ORIGIN
 *
 * USAGE:
 *   import { getCorsHeaders, handleCorsOptions } from './_cors.js';
 *
 *   // In OPTIONS handler:
 *   export async function onRequestOptions(context) {
 *     return handleCorsOptions(context.env, context.request);
 *   }
 *
 *   // In response:
 *   return new Response(JSON.stringify(data), {
 *     headers: getCorsHeaders(env, request)
 *   });
 *
 * @module functions/api/_cors

 */

/**
 * Default CORS origin when CORS_ORIGIN env var is not set.
 * Using '*' maintains backward compatibility with existing deployments.
 */
const DEFAULT_CORS_ORIGIN = '*';

/**
 * Get the allowed CORS origin from environment configuration.
 *
 * If CORS_ORIGIN is set to a specific domain, only that domain is allowed.
 * If CORS_ORIGIN is '*' or not set, all origins are allowed.
 *
 * @param {Object} env - Environment variables from Cloudflare
 * @param {Request} request - The incoming request (used to get Origin header)
 * @returns {string} The origin to use in Access-Control-Allow-Origin header
 */
export function getAllowedOrigin(env, request) {
    const configuredOrigin = env?.CORS_ORIGIN || DEFAULT_CORS_ORIGIN;

    // If wildcard, allow all origins
    if (configuredOrigin === '*') {
        return '*';
    }

    // If specific origin configured, validate against request Origin
    const requestOrigin = request?.headers?.get('Origin');

    // If request has an Origin header that matches configured origin, echo it back
    // This is more secure than always returning the configured origin
    if (requestOrigin && requestOrigin === configuredOrigin) {
        return requestOrigin;
    }

    // For same-origin requests (no Origin header) or matching origins, return configured
    // For non-matching origins, still return configured (browser will block the response)
    return configuredOrigin;
}

/**
 * Generate CORS headers for a response.
 *
 * @param {Object} env - Environment variables from Cloudflare
 * @param {Request} request - The incoming request
 * @param {Object} options - Additional options
 * @param {string} options.methods - Allowed HTTP methods (default: 'GET, POST, OPTIONS')
 * @param {string} options.headers - Allowed request headers
 * @returns {Object} Headers object to spread into Response headers
 */
export function getCorsHeaders(env, request, options = {}) {
    const {
        methods = 'GET, POST, OPTIONS',
        headers: allowedHeaders = 'Content-Type, Authorization'
    } = options;

    return {
        'Access-Control-Allow-Origin': getAllowedOrigin(env, request),
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': allowedHeaders,
        'Content-Type': 'application/json'
    };
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 *
 * Browsers send OPTIONS requests before making cross-origin requests
 * with certain characteristics (POST with JSON, custom headers, etc.).
 *
 * @param {Object} env - Environment variables from Cloudflare
 * @param {Request} request - The incoming OPTIONS request
 * @param {Object} options - Additional options for getCorsHeaders
 * @returns {Response} Empty response with CORS headers
 */
export function handleCorsOptions(env, request, options = {}) {
    return new Response(null, {
        status: 204,
        headers: getCorsHeaders(env, request, options)
    });
}

// NOTE: jsonResponse moved to _response.js for consistency
// Import from there: import { jsonResponse } from './_response.js';
