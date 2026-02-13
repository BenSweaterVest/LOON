/**
 * Health endpoint (`GET /api/health`).
 * Reports required and optional runtime configuration checks.
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { getKVBinding } from './_kv.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

/**
 * Handles CORS preflight requests.
 */
export async function onRequestOptions(context) {
  return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * Handles health requests.
 */
export async function onRequestGet(context) {
  const { env, request } = context;

  const checks = {
    github_repo: !!env.GITHUB_REPO,
    github_token: !!env.GITHUB_TOKEN,
    kv_database: !!getKVBinding(env),
    images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN,
    passkeys_rp_id: !!env.RP_ID,
    passkeys_rp_origin: !!env.RP_ORIGIN,
    passkeys_ready: !!env.RP_ID && !!env.RP_ORIGIN
  };

  const requiredChecks = [checks.github_repo, checks.github_token, checks.kv_database];
  const allHealthy = requiredChecks.every(v => v);

  const responseBody = {
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: checks
  };

  const headers = getCorsHeaders(env, request, CORS_OPTIONS);

  return new Response(
    JSON.stringify(responseBody),
    {
      status: allHealthy ? 200 : 503,
      headers: headers
    }
  );
}
