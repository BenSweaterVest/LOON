/**
 * ============================================================================
 * LOON Pages Endpoint (functions/api/pages.js)
 * ============================================================================
 *
 * Lists available pages/content that users can edit. Works with both Phase 1
 * and Phase 2 authentication modes.
 *
 * ENDPOINTS:
 *   GET /api/pages - List all available pages
 *
 * QUERY PARAMETERS:
 *   ?minimal=true  - Return only pageId list (reduces GitHub API calls)
 *   ?page=1        - Page number for pagination (default: 1)
 *   ?limit=20      - Items per page (default: 20, max: 100)
 *
 * PHASE 1 (Directory Mode):
 *   No authentication required - returns all pages with schemas
 *
 * PHASE 2 (Team Mode):
 *   Optional authentication - if token provided:
 *   - Contributors see only pages they created
 *   - Editors/Admins see all pages
 *
 * RESPONSE:
 *   {
 *     "pages": [
 *       {
 *         "pageId": "demo",
 *         "title": "Demo Page",
 *         "hasContent": true,
 *         "createdBy": "admin",        // Phase 2 only
 *         "lastModified": "2025-01-30" // If content exists
 *       }
 *     ],
 *     "mode": "team",       // "directory" or "team"
 *     "canEditAll": true,   // Whether user can edit all pages
 *     "total": 25,          // Total pages available
 *     "page": 1,            // Current page number
 *     "limit": 20,          // Items per page
 *     "hasMore": true       // Whether more pages exist
 *   }
 *
 * PERFORMANCE NOTES:
 *   This endpoint previously made 2 GitHub API calls per page (schema + content),
 *   which could hit rate limits with many pages. The current implementation:
 *   - Uses a single directory listing call for minimal mode
 *   - Fetches schema/content in parallel with Promise.all
 *   - Supports ?minimal=true for lightweight listing
 *   - Caches directory structure for 60 seconds (in-memory)
 *   - Supports pagination to limit response size
 *
 * @module functions/api/pages
 * @version 2.1.0 (Shared - Both Phases)
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    /**
     * Default number of items per page for pagination.
     * Balances response size with usability.
     */
    DEFAULT_PAGE_SIZE: 20,

    /**
     * Maximum items per page to prevent excessive API calls.
     * Each page requires 2 GitHub API calls (schema + content).
     */
    MAX_PAGE_SIZE: 100,

    /**
     * Cache duration for directory listing in milliseconds.
     * Reduces GitHub API calls for rapid successive requests.
     * Default: 60 seconds
     */
    CACHE_TTL_MS: 60000
};

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

/**
 * Simple in-memory cache for directory listings.
 * Reduces GitHub API calls when multiple users browse pages simultaneously.
 *
 * Note: This cache is per-worker instance and resets on worker restart.
 * For production with high traffic, consider using Cloudflare KV caching.
 */
const directoryCache = {
    data: null,
    timestamp: 0
};

/**
 * Check if cached directory data is still valid.
 * @returns {boolean} True if cache is valid and not expired
 */
function isCacheValid() {
    return directoryCache.data !== null &&
           (Date.now() - directoryCache.timestamp) < CONFIG.CACHE_TTL_MS;
}

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

/**
 * Handle GET request - List pages
 *
 * Supports both minimal (fast) and full (detailed) listing modes.
 * Use ?minimal=true for page selection dropdowns where full metadata
 * is not needed.
 */
export async function onRequestGet(context) {
    const { request, env } = context;

    // Check required env vars
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    try {
        // Parse query parameters
        const url = new URL(request.url);
        const minimal = url.searchParams.get('minimal') === 'true';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(
            CONFIG.MAX_PAGE_SIZE,
            Math.max(1, parseInt(url.searchParams.get('limit') || String(CONFIG.DEFAULT_PAGE_SIZE), 10))
        );

        // Check for Phase 2 authentication (optional)
        let session = null;
        const db = env.LOON_DB;
        const authHeader = request.headers.get('Authorization');

        if (db && authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const sessionRaw = await db.get(`session:${token}`);
            if (sessionRaw) {
                session = JSON.parse(sessionRaw);
            }
        }

        // Determine mode and permissions
        const mode = db ? 'team' : 'directory';
        const canEditAll = !session || session.role === 'admin' || session.role === 'editor';

        // Fetch page list from GitHub
        const allPages = await fetchPagesFromGitHub(env, minimal);

        // Filter for contributors in Team Mode
        let filteredPages = allPages;
        if (session && session.role === 'contributor') {
            // Contributors only see pages they created
            filteredPages = allPages.filter(p =>
                !p.createdBy || p.createdBy === session.username
            );
        }

        // Apply pagination
        const total = filteredPages.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedPages = filteredPages.slice(startIndex, endIndex);
        const hasMore = endIndex < total;

        return jsonResponse({
            pages: paginatedPages,
            mode: mode,
            canEditAll: canEditAll,
            total: total,
            page: page,
            limit: limit,
            hasMore: hasMore
        }, 200, env, request);

    } catch (err) {
        console.error('Pages API error:', err);
        return jsonResponse({ error: 'Failed to list pages', details: err.message }, 500, env, request);
    }
}

// ============================================================================
// GITHUB API INTEGRATION
// ============================================================================

/**
 * Fetch list of pages from GitHub repository.
 *
 * This function has two modes:
 * - Minimal: Returns only pageId (1 GitHub API call total)
 * - Full: Returns pageId, title, metadata (1 + 2*N API calls)
 *
 * The directory listing is cached for 60 seconds to reduce API calls
 * when multiple users access the endpoint in quick succession.
 *
 * @param {Object} env - Environment variables (GITHUB_TOKEN, GITHUB_REPO)
 * @param {boolean} minimal - If true, skip fetching schema/content details
 * @returns {Promise<Array>} Array of page objects
 */
async function fetchPagesFromGitHub(env, minimal = false) {
    const headers = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LOON-CMS/2.1'
    };

    // Check cache for directory listing
    let directories;
    if (isCacheValid()) {
        directories = directoryCache.data;
    } else {
        // Fetch fresh directory listing
        const dataUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data`;
        const dataRes = await fetch(dataUrl, { headers });

        if (!dataRes.ok) {
            if (dataRes.status === 404) {
                return []; // No data directory yet
            }
            throw new Error(`GitHub API error: ${dataRes.status}`);
        }

        const dataContents = await dataRes.json();

        // Filter for directories (each directory is a page)
        directories = dataContents.filter(item => item.type === 'dir');

        // Update cache
        directoryCache.data = directories;
        directoryCache.timestamp = Date.now();
    }

    // Minimal mode: return only pageIds (no additional API calls)
    if (minimal) {
        const pages = directories.map(dir => ({
            pageId: dir.name,
            title: dir.name
        }));
        pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
        return pages;
    }

    // Full mode: fetch schema and content for each page
    // Use Promise.all for parallel requests to improve performance
    const pages = await Promise.all(directories.map(async (dir) => {
        const pageId = dir.name;
        const page = {
            pageId: pageId,
            title: pageId, // Default to pageId
            hasContent: false,
            hasSchema: false
        };

        try {
            // Fetch schema and content in parallel for this page
            const [schemaResult, contentResult] = await Promise.all([
                fetchFileFromGitHub(env, headers, `data/${pageId}/schema.json`),
                fetchFileFromGitHub(env, headers, `data/${pageId}/content.json`)
            ]);

            // Process schema
            if (schemaResult.exists) {
                page.hasSchema = true;
                if (schemaResult.content && schemaResult.content.title) {
                    page.title = schemaResult.content.title;
                }
            }

            // Process content
            if (contentResult.exists) {
                page.hasContent = true;
                const content = contentResult.content;

                // Extract metadata if present
                if (content && content._meta) {
                    if (content._meta.createdBy) page.createdBy = content._meta.createdBy;
                    if (content._meta.modifiedBy) page.modifiedBy = content._meta.modifiedBy;
                    if (content._meta.lastModified) page.lastModified = content._meta.lastModified;
                    if (content._meta.created) page.created = content._meta.created;
                }
            }
        } catch (e) {
            // Continue with partial data; log for debugging
            console.error(`Error fetching details for ${pageId}:`, e);
        }

        return page;
    }));

    // Sort by title
    pages.sort((a, b) => a.title.localeCompare(b.title));

    return pages;
}

/**
 * Fetch a single file from GitHub and parse as JSON.
 *
 * @param {Object} env - Environment variables
 * @param {Object} headers - HTTP headers for GitHub API
 * @param {string} path - File path within the repository
 * @returns {Promise<{exists: boolean, content: Object|null}>}
 */
async function fetchFileFromGitHub(env, headers, path) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
        return { exists: false, content: null };
    }

    const data = await res.json();
    const content = JSON.parse(atob(data.content));
    return { exists: true, content: content };
}

// ============================================================================
// CORS AND RESPONSE HELPERS
// ============================================================================

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}

/**
 * JSON response helper with configurable CORS.
 *
 * @param {Object} data - Response data to serialize as JSON
 * @param {number} status - HTTP status code (default: 200)
 * @param {Object} env - Environment variables from Cloudflare
 * @param {Request} request - The incoming request
 * @returns {Response} HTTP Response object
 */
function jsonResponse(data, status = 200, env = null, request = null) {
    const headers = env && request
        ? getCorsHeaders(env, request, CORS_OPTIONS)
        : {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        };

    return new Response(JSON.stringify(data, null, 2), { status, headers });
}
