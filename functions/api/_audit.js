/**
 * ============================================================================
 * LOON Audit Logging Utility (functions/api/_audit.js)
 * ============================================================================
 *
 * Centralized audit logging for tracking key actions in the CMS.
 * Logs are stored in Cloudflare KV with automatic expiration.
 *
 * USAGE:
 *   import { logAudit } from './_audit.js';
 *   await logAudit(db, 'login', 'admin', { ip: '1.2.3.4' });
 *
 * LOG FORMAT:
 *   Key: audit:{timestamp}:{action}:{username}
 *   Value: {
 *     "action": "login",
 *     "username": "admin",
 *     "details": { "ip": "1.2.3.4" },
 *     "timestamp": "2026-01-30T12:00:00.000Z"
 *   }
 *
 * TRACKED ACTIONS:
 *   - login          - User logged in
 *   - logout         - User logged out
 *   - password_change - User changed their password
 *   - content_save   - Content was saved
 *   - content_delete - Content was deleted
 *   - page_create    - New page was created
 *   - user_create    - New user was created
 *   - user_delete    - User was deleted
 *   - user_update    - User was updated (role change, etc)
 *   - password_reset - Admin reset a user's password
 *
 * RETENTION:
 *   Audit logs are automatically deleted after 30 days (configurable).
 *
 * @module functions/api/_audit
 * @version 3.0.0
 */

/**
 * Log an audit event to KV storage.
 *
 * @param {KVNamespace} db - Cloudflare KV namespace binding
 * @param {string} action - The action being logged (e.g., 'login', 'save')
 * @param {string} username - The user performing the action
 * @param {Object} details - Additional context (ip, pageId, etc.)
 * @param {number} ttlDays - Days to retain log (default: 30)
 * @returns {Promise<void>}
 */
export async function logAudit(db, action, username, details = {}, ttlDays = 30) {
    if (!db) {
        console.warn('Audit logging skipped: KV not available');
        return;
    }

    try {
        const timestamp = Date.now();
        const key = `audit:${timestamp}:${action}:${username}`;

        const logEntry = {
            action,
            username,
            details,
            timestamp: new Date().toISOString()
        };

        await db.put(key, JSON.stringify(logEntry), {
            expirationTtl: 86400 * ttlDays // Convert days to seconds
        });

    } catch (err) {
        // Don't fail the main operation if audit logging fails
        console.error('Audit logging error:', err);
    }
}

/**
 * Retrieve audit logs from KV storage.
 *
 * @param {KVNamespace} db - Cloudflare KV namespace binding
 * @param {Object} options - Query options
 * @param {string} options.action - Filter by action type
 * @param {string} options.username - Filter by username
 * @param {number} options.limit - Max results (default: 100)
 * @returns {Promise<Array>} Array of audit log entries
 */
export async function getAuditLogs(db, options = {}) {
    if (!db) {
        return [];
    }

    const { action, username, limit = 100 } = options;

    try {
        // List all audit keys
        const listResult = await db.list({ prefix: 'audit:', limit: 1000 });

        // Fetch and filter logs
        const logs = [];

        for (const key of listResult.keys) {
            // Quick filter by key pattern if username/action specified
            if (action && !key.name.includes(`:${action}:`)) continue;
            if (username && !key.name.endsWith(`:${username}`)) continue;

            const value = await db.get(key.name, { type: 'json' });
            if (value) {
                logs.push(value);
            }

            if (logs.length >= limit) break;
        }

        // Sort by timestamp descending (newest first)
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return logs.slice(0, limit);

    } catch (err) {
        console.error('Error retrieving audit logs:', err);
        return [];
    }
}
