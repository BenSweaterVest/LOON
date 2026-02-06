/**
 * ============================================================================
 * LOON Response Utilities (functions/api/_response.js)
 * ============================================================================
 *
 * Standardized response formatting across all API endpoints.
 * Handles JSON responses, CORS headers, error responses, and logging.
 *
 * USAGE:
 *   import { jsonResponse, errorResponse, logError } from './_response.js';
 *   return jsonResponse({ data: 'value' }, 200, env, request);
 *
 * @module functions/api/_response
 */

import { getCorsHeaders } from './_cors.js';

/**
 * Send a JSON response with CORS headers.
 *
 * @param {Object|Array} data - Data to return
 * @param {number} status - HTTP status code (default: 200)
 * @param {Object} env - Cloudflare environment bindings
 * @param {Request} request - Fetch request object (for CORS handling)
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, env, request) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                ...getCorsHeaders(env, request),
                'Content-Type': 'application/json'
            }
        }
    );
}

/**
 * Send an error response with sanitized message.
 * Prevents leaking internal details to clients.
 *
 * @param {string} message - Public-facing error message
 * @param {number} status - HTTP status code
 * @param {Error|null} internalError - Internal error for logging (not returned to client)
 * @param {Object} env - Cloudflare environment bindings
 * @param {Request} request - Fetch request object
 * @param {string} context - Brief context for logging (e.g., 'upload', 'save')
 * @returns {Response}
 */
export function errorResponse(message, status, internalError, env, request, context = 'API') {
    logError(internalError, context, env);
    
    return jsonResponse(
        { error: message },
        status,
        env,
        request
    );
}

/**
 * Log an error safely without exposing sensitive details.
 *
 * @param {Error|null} error - Error object to log
 * @param {string} context - Context for the error (e.g., 'upload', 'auth')
 * @param {Object} env - Environment object (for checking debug mode)
 */
export function logError(error, context = 'API', env = {}) {
    if (!error) return;
    
    // Only log detailed errors in development/debug mode
    // Production environments should have ENVIRONMENT !== 'production' check
    const isDevelopment = env.ENVIRONMENT !== 'production' && env.ENVIRONMENT !== 'prod';
    
    if (isDevelopment) {
        console.error(`[${context}] Error:`, {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
    } else {
        // Production: log minimal info
        console.error(`[${context}] Error: ${error.message}`);
    }
}

/**
 * Validate required environment variables.
 *
 * @param {Object} env - Environment object
 * @param {string[]} required - List of required variable names
 * @returns {Object} - { valid: boolean, missing: string[] }
 */
export function validateEnv(env, required = []) {
    const missing = required.filter(varName => !env[varName]);
    return {
        valid: missing.length === 0,
        missing
    };
}

/**
 * Create a standardized rate limit response.
 *
 * @param {number} retriesRemaining - Number of retries allowed
 * @param {number} resetSeconds - Seconds until reset
 * @param {Object} env - Environment object
 * @param {Request} request - Fetch request object
 * @returns {Response}
 */
export function rateLimitResponse(retriesRemaining, resetSeconds, env, request) {
    return new Response(
        JSON.stringify({
            error: 'Too many requests. Try again later.',
            retriesRemaining,
            resetSeconds
        }),
        {
            status: 429,
            headers: {
                ...getCorsHeaders(env, request),
                'Content-Type': 'application/json',
                'Retry-After': String(resetSeconds)
            }
        }
    );
}

/**
 * Create a standardized authentication error response.
 *
 * @param {string} message - Error message (default: 'Authentication required')
 * @param {Object} env - Environment object
 * @param {Request} request - Fetch request object
 * @returns {Response}
 */
export function authErrorResponse(message = 'Authentication required', env, request) {
    return jsonResponse(
        { error: message },
        401,
        env,
        request
    );
}

/**
 * Create a standardized authorization error response.
 *
 * @param {string} message - Error message (default: 'Insufficient permissions')
 * @param {Object} env - Environment object
 * @param {Request} request - Fetch request object
 * @returns {Response}
 */
export function forbiddenResponse(message = 'Insufficient permissions', env, request) {
    return jsonResponse(
        { error: message },
        403,
        env,
        request
    );
}

/**
 * Create a standardized validation error response.
 *
 * @param {string} message - Error message (default: 'Invalid request')
 * @param {Object} details - Additional validation details (optional)
 * @param {Object} env - Environment object
 * @param {Request} request - Fetch request object
 * @returns {Response}
 */
export function validationErrorResponse(message = 'Invalid request', details = {}, env, request) {
    return jsonResponse(
        { error: message, details },
        400,
        env,
        request
    );
}
