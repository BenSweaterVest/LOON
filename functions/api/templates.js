/**
 * ============================================================================
 * LOON Templates Endpoint (functions/api/templates.js)
 * ============================================================================
 *
 * Lists available schema templates from the examples/ directory.
 * Used by the admin UI for page creation with pre-built templates.
 *
 * ENDPOINT:
 *   GET /api/templates - List all available templates
 *
 * RESPONSE:
 *   {
 *     "templates": [
 *       {
 *         "id": "blog-post",
 *         "title": "Blog Post Editor",
 *         "description": "Create or edit a blog post",
 *         "fieldCount": 6
 *       },
 *       ...
 *     ],
 *     "total": 15
 *   }
 *
 * AUTHENTICATION:
 *   None required - templates are public
 *
 * @module functions/api/templates

 */

import { handleCorsOptions } from './_cors.js';
import { logError, jsonResponse } from './_response.js';
import { getRepoFileJson, listRepoDirectory } from '../lib/github.js';

/**
 * CORS options for this endpoint.
 */
const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

const templateCache = {
    data: null,
    timestamp: 0
};

const CACHE_TTL_MS = 300000; // 5 minutes (templates change rarely)

function isCacheValid() {
    return templateCache.data !== null &&
           (Date.now() - templateCache.timestamp) < CACHE_TTL_MS;
}

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

/**
 * Handle GET request - List templates
 */
export async function onRequestGet(context) {
    const { request, env } = context;

    // Check required env vars
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);
    }

    try {
        // Check cache
        if (isCacheValid()) {
            return jsonResponse({
                templates: templateCache.data,
                total: templateCache.data.length
            }, 200, env, request);
        }

        // Fetch templates from examples/ directory
        const templates = await fetchTemplates(env);

        // Update cache
        templateCache.data = templates;
        templateCache.timestamp = Date.now();

        return jsonResponse({
            templates: templates,
            total: templates.length
        }, 200, env, request);

    } catch (err) {
        logError(err, 'Templates/List');
        return jsonResponse({ error: 'Failed to list templates' }, 500, env, request);
    }
}

/**
 * Fetch templates from GitHub examples/ directory
 */
async function fetchTemplates(env) {
    // List examples/ directory
    const contents = await listRepoDirectory(env, 'examples');
    if (!contents) {
        return []; // No examples directory
    }
    const directories = contents.filter(item => item.type === 'dir');

    // Fetch schema for each template in parallel
    const templates = await Promise.all(directories.map(async (dir) => {
        const templateId = dir.name;
        const template = {
            id: templateId,
            title: templateId, // Default
            description: '',
            fieldCount: 0
        };

        try {
            const schemaData = await getRepoFileJson(env, `examples/${templateId}/schema.json`);
            if (schemaData.exists) {
                const schema = schemaData.content;
                if (schema?.title) template.title = schema.title;
                if (schema?.description) template.description = schema.description;
                if (Array.isArray(schema?.fields)) template.fieldCount = schema.fields.length;
            }
        } catch (e) {
            // Continue with defaults; server-side logging available
            logError(e, 'Templates/Load');
        }

        return template;
    }));

    // Sort by title
    templates.sort((a, b) => a.title.localeCompare(b.title));

    return templates;
}

/**
 * Handle OPTIONS (CORS preflight)
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
