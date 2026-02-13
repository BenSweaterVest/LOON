/**
 * Pages endpoint.
 * - GET `/api/pages`: list pages
 * - POST `/api/pages`: create page (admin/editor)
 */

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getUnchangedSanitizedPageId, isValidPageId } from '../lib/page-id.js';
import { getRepoFileJson, listRepoDirectory, putRepoFileJson, repoPathExists } from '../lib/github.js';
import { getBearerToken } from '../lib/session.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, POST, OPTIONS' };

const CONFIG = {
    // Pagination defaults.
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    CACHE_TTL_MS: 60000
};
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

        // Check for authentication (optional)
        let session = null;
        const db = getKVBinding(env);
        const authHeader = request.headers.get('Authorization');

        if (db && authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const sessionRaw = await db.get(`session:${token}`);
            if (sessionRaw) {
                session = JSON.parse(sessionRaw);
            }
        }

        // Determine permissions
        const canEditAll = !!session && (session.role === 'admin' || session.role === 'editor');

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
            canEditAll: canEditAll,
            total: total,
            page: page,
            limit: limit,
            hasMore: hasMore
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Pages/List');
        return jsonResponse({ error: 'Failed to list pages' }, 500, env, request);
    }
}

/**
 * Handle POST request - Create a new page
 *
 * Creates a new page with schema and initial empty content.
 * Admin or Editor role required.
 *
 * Request body:
 *   - pageId: Required. Lowercase alphanumeric, hyphens, underscores (3-50 chars)
 *   - title: Optional. Human-readable title (defaults to pageId)
 *   - template: Optional. Name of template from examples/ directory
 *   - schema: Optional. Custom schema object (overrides template)
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = getKVBinding(env);

    // Check required bindings
    if (!db) {
        return jsonResponse({ error: 'KV not configured. Configure a KV binding named LOON_DB (preferred) or KV' }, 500, env, request);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    try {
        // Validate session
        const token = getBearerToken(request);
        if (!token) {
            return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        }

        const sessionRaw = await db.get(`session:${token}`);

        if (!sessionRaw) {
            return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
        }

        const session = JSON.parse(sessionRaw);

        // Check role - only admin/editor can create pages
        if (session.role !== 'admin' && session.role !== 'editor') {
            return jsonResponse({ error: 'Admin or Editor role required to create pages' }, 403, env, request);
        }

        // Parse request body
        const { pageId, title, template, schema: customSchema } = await request.json();

        // Validate pageId
        if (!pageId) {
            return jsonResponse({ error: 'pageId is required' }, 400, env, request);
        }

        // Sanitize and validate pageId format
        const sanitizedPageId = getUnchangedSanitizedPageId(pageId, { min: 1, max: 200 });
        if (!sanitizedPageId) {
            return jsonResponse({ error: 'Invalid pageId format. Use lowercase letters, numbers, hyphens, and underscores only.' }, 400, env, request);
        }

        if (!isValidPageId(sanitizedPageId, { min: 3, max: 50 })) {
            return jsonResponse({ error: 'pageId must be 3-50 characters' }, 400, env, request);
        }

        // Check if page already exists
        const existingCheck = await checkPageExists(env, sanitizedPageId);
        if (existingCheck.exists) {
            return jsonResponse({ error: `Page "${sanitizedPageId}" already exists` }, 409, env, request);
        }

        // Determine schema to use
        let schemaContent;
        if (customSchema) {
            // Use provided custom schema
            schemaContent = customSchema;
        } else if (template) {
            // Load template from examples/
            const templateSchema = await loadTemplate(env, template);
            if (!templateSchema) {
                return jsonResponse({ error: `Template "${template}" not found` }, 404, env, request);
            }
            schemaContent = templateSchema;
        } else {
            // Default minimal schema
            schemaContent = {
                title: title || sanitizedPageId,
                description: `Content for ${sanitizedPageId}`,
                fields: [
                    {
                        key: 'content',
                        label: 'Content',
                        type: 'textarea',
                        placeholder: 'Enter content here...'
                    }
                ]
            };
        }

        // Override title if provided
        if (title) {
            schemaContent.title = title;
        }

        // Create initial content with metadata
        const contentData = {
            _meta: {
                createdBy: session.username,
                created: new Date().toISOString(),
                modifiedBy: session.username,
                lastModified: new Date().toISOString()
            }
        };

        // Commit schema to GitHub
        const schemaPath = `data/${sanitizedPageId}/schema.json`;
        const schemaCommit = await commitToGitHub(
            env,
            schemaPath,
            schemaContent,
            `Create ${sanitizedPageId} schema by ${session.username}`,
            null
        );

        // Commit content to GitHub
        const contentPath = `data/${sanitizedPageId}/content.json`;
        const contentCommit = await commitToGitHub(
            env,
            contentPath,
            contentData,
            `Create ${sanitizedPageId} content by ${session.username}`,
            null
        );

        // Invalidate cache
        directoryCache.data = null;
        directoryCache.timestamp = 0;

        // Audit log
        await logAudit(db, 'page_create', session.username, { pageId: sanitizedPageId, template: template || 'custom' });

        return jsonResponse({
            success: true,
            pageId: sanitizedPageId,
            schemaCommit: schemaCommit,
            contentCommit: contentCommit,
            createdBy: session.username,
            schema: schemaContent,
            content: contentData
        }, 201, env, request);

    } catch (err) {
        logError(err, 'Pages/Create');
        return jsonResponse({ error: 'Failed to create page' }, 500, env, request);
    }
}

/**
 * Check if a page already exists in GitHub
 */
async function checkPageExists(env, pageId) {
    return { exists: await repoPathExists(env, `data/${pageId}`) };
}

/**
 * Load a template schema from the examples/ directory
 */
async function loadTemplate(env, templateName) {
    const data = await getRepoFileJson(env, `examples/${templateName}/schema.json`);
    if (!data.exists) {
        return null;
    }
    return data.content;
}

/**
 * Commit a file to GitHub
 */
async function commitToGitHub(env, path, content, message, existingSha) {
    return putRepoFileJson(env, path, content, message, existingSha);
}

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
    // Check cache for directory listing
    let directories;
    if (isCacheValid()) {
        directories = directoryCache.data;
    } else {
        // Fetch fresh directory listing
        const dataContents = await listRepoDirectory(env, 'data');
        if (!dataContents) {
            return []; // No data directory yet
        }

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
                fetchFileFromGitHub(env, `data/${pageId}/schema.json`),
                fetchFileFromGitHub(env, `data/${pageId}/content.json`)
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
            // Continue with partial data; server-side logging available
            logError(e, 'Pages/Details');
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
 * @param {string} path - File path within the repository
 * @returns {Promise<{exists: boolean, content: Object|null}>}
 */
async function fetchFileFromGitHub(env, path) {
    return getRepoFileJson(env, path);
}

/**
 * Handle OPTIONS (CORS preflight)
 * Uses shared CORS utility that respects CORS_ORIGIN environment variable.
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
