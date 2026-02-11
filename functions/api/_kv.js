/**
 * ============================================================================
 * LOON KV Binding Utility (functions/api/_kv.js)
 * ============================================================================
 *
 * Flexible KV namespace binding that supports custom namespace names
 * via environment variables while maintaining backward compatibility.
 *
 * USAGE:
 *   import { getKVBinding } from './_kv.js';
 *   const db = getKVBinding(env);
 *   if (!db) {
 *     return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
 *   }
 *
 * CONFIGURATION:
 *   By default uses `LOON_DB` binding.
 *   Also supports `KV` binding as compatibility fallback.
 *   Set KV_NAMESPACE environment variable to override:
 *     KV_NAMESPACE=my-custom-namespace
 *   Set KV_NAMESPACE_ID for explicit namespace ID configuration:
 *     KV_NAMESPACE_ID=abc123def456
 *
 * @module functions/api/_kv

 */

/**
 * Get KV namespace binding with flexible configuration support.
 * Checks environment variables to allow custom namespace names.
 *
 * @param {Object} env - Cloudflare environment object
 * @returns {KVNamespace|null} - KV namespace binding or null if not available
 */
export function getKVBinding(env) {
    // Priority order:
    // 1. Custom namespace via KV_NAMESPACE env var
    // 2. LOON_DB binding (preferred)
    // 3. KV binding (compatibility fallback)
    
    if (!env) {
        return null;
    }
    
    // Check for custom namespace binding via environment variable
    // Users can set KV_NAMESPACE=custom_name and then bind that in Cloudflare.
    const customBindingName = env.KV_NAMESPACE;
    if (customBindingName && typeof customBindingName === 'string' && env[customBindingName]) {
        return env[customBindingName];
    }

    return env.LOON_DB || env.KV || null;
}

/**
 * Validate KV namespace is accessible and working.
 * Useful for health checks and diagnostics.
 *
 * @param {KVNamespace} db - KV namespace to test
 * @returns {Promise<boolean>} - True if KV is accessible
 */
export async function isKVHealthy(db) {
    if (!db) {
        return false;
    }
    
    try {
        // Quick test: try to set and get a test key with short TTL
        const testKey = `__health:${Date.now()}`;
        await db.put(testKey, 'test', { expirationTtl: 1 });
        const value = await db.get(testKey);
        return value === 'test';
    } catch (err) {
        return false;
    }
}

/**
 * Get KV namespace ID from environment.
 * Useful for documentation and debugging.
 *
 * @param {Object} env - Environment object
 * @returns {string|null} - Namespace ID or null
 */
export function getKVNamespaceId(env) {
    // In Cloudflare, binding name and namespace ID are configured separately
    // This returns the configured namespace ID if provided
    return env.KV_NAMESPACE_ID || null;
}
