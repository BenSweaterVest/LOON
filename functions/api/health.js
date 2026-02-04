/**
 * ============================================================================
 * LOON Health Check Endpoint (functions/api/health.js)
 * ============================================================================
 *
 * A simple endpoint to verify the system is operational.
 * Useful for:
 *   - Monitoring and alerting
 *   - Debugging configuration issues
 *   - Load balancer health checks
 *   - Verifying deployment was successful
 *
 * ENDPOINT: GET /api/health
 *
 * RESPONSE:
 *   {
 *     "status": "ok" | "degraded",
 *     "timestamp": "2026-01-30T12:00:00.000Z",
 *     "checks": {
 *       "github_repo": true,
 *       "github_token": true,
 *       "kv_database": true
 *     }
 *   }
 *
 * STATUS VALUES:
 *   - "ok": All required configuration is present (GitHub + KV)
 *   - "degraded": One or more required items are missing
 *
 * HTTP STATUS CODES:
 *   - 200: System is healthy (status: "ok")
 *   - 503: System is degraded (missing configuration)
 *
 * SECURITY NOTES:
 *   - Does NOT expose actual secret values
 *   - Only reports whether variables are configured (boolean)
 *   - Safe to expose publicly (no sensitive data in response)
 *
 * @module functions/api/health

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

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
 * Health check handler.
 * 
 * Verifies that required environment variables are configured.
 * Does NOT test actual connectivity to GitHub (that would be slow
 * and could affect rate limits).
 * 
 * @param {Object} context - Cloudflare Pages Function context
 * @param {Object} context.env - Environment variables
 * @returns {Response} JSON health status
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  
  // ========================================================================
  // CONFIGURATION CHECKS
  // ========================================================================
  // Check for presence of required environment variables
  // We only check if they exist, NOT their actual values (security)
  const checks = {
    /**
     * GITHUB_REPO should be in "owner/repo" format
     */
    github_repo: !!env.GITHUB_REPO,
    
    /**
     * GITHUB_TOKEN should be a valid Personal Access Token
     */
    github_token: !!env.GITHUB_TOKEN,
    
    /**
     * LOON_DB is the KV namespace binding (required)
     */
    kv_database: !!env.LOON_DB,

    /**
     * Optional: Cloudflare Images (media uploads)
     */
    images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN
  };

  // ========================================================================
  // DETERMINE OVERALL STATUS
  // ========================================================================
  // System is "ok" if all required variables are configured
  // KV is required for user and session storage
  const requiredChecks = [checks.github_repo, checks.github_token, checks.kv_database];
  const allHealthy = requiredChecks.every(v => v);
  
  // ========================================================================
  // BUILD RESPONSE
  // ========================================================================
  const responseBody = {
    /**
     * Overall system status
     * "ok" = fully operational
     * "degraded" = missing configuration, will not function correctly
     */
    status: allHealthy ? 'ok' : 'degraded',
    
    /**
     * Current server timestamp (useful for debugging timezone issues)
     */
    timestamp: new Date().toISOString(),
    
    /**
     * Individual check results
     * true = configured, false = missing
     */
    checks: checks
  };
  
  // Return 503 Service Unavailable if degraded, 200 OK if healthy
  const headers = getCorsHeaders(env, request, CORS_OPTIONS);

  return new Response(
    JSON.stringify(responseBody),
    {
      status: allHealthy ? 200 : 503,
      headers: headers
    }
  );
}
