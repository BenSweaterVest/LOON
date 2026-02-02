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
 * @version 3.0.0
 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';

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
        console.error('Templates API error:', err);
        return jsonResponse({ error: 'Failed to list templates', details: err.message }, 500, env, request);
    }
}

/**
 * Fetch templates from GitHub examples/ directory
 */
async function fetchTemplates(env) {
    const headers = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LOON-CMS/3.0'
    };

    // List examples/ directory
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/examples`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
        if (res.status === 404) {
            return []; // No examples directory
        }
        throw new Error(`GitHub API error: ${res.status}`);
    }

    const contents = await res.json();
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
            const schemaUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/examples/${templateId}/schema.json`;
            const schemaRes = await fetch(schemaUrl, { headers });

            if (schemaRes.ok) {
                const schemaData = await schemaRes.json();
                const schema = JSON.parse(atob(schemaData.content));

                if (schema.title) template.title = schema.title;
                if (schema.description) template.description = schema.description;
                if (schema.fields) template.fieldCount = schema.fields.length;
            }
        } catch (e) {
            // Continue with defaults
            console.error(`Error loading template ${templateId}:`, e);
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

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, env = null, request = null) {
    const headers = env && request
        ? getCorsHeaders(env, request, CORS_OPTIONS)
        : {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

    return new Response(JSON.stringify(data, null, 2), { status, headers });
}
