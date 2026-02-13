/**
 * ============================================================================
 * LOON Blocks Endpoint (functions/api/blocks.js)
 * ============================================================================
 *
 * Returns reusable content snippets ("blocks") for editor insertion.
 *
 * ENDPOINT: GET /api/blocks
 */

import { handleCorsOptions } from './_cors.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';
import { getRepoFileJson } from '../lib/github.js';

const CORS_OPTIONS = { methods: 'GET, OPTIONS' };

const DEFAULT_BLOCKS = [
    {
        id: 'call_to_action',
        label: 'Call To Action',
        content: '## Call to Action\nAdd your action text here.'
    },
    {
        id: 'contact_card',
        label: 'Contact Card',
        content: '### Contact\nEmail: example@example.com\nPhone: (000) 000-0000'
    },
    {
        id: 'two_column_note',
        label: 'Two-Column Note',
        content: '| Left | Right |\n|---|---|\n| Item A | Item B |'
    }
];

async function loadBlocksFromRepo(env) {
    const file = await getRepoFileJson(env, 'data/_blocks/blocks.json');
    if (!file.exists) return null;
    const parsed = file.content;
    if (!Array.isArray(parsed)) return null;
    return parsed
        .filter(item => item && item.id && item.label && typeof item.content === 'string')
        .map(item => ({ id: String(item.id), label: String(item.label), content: String(item.content) }));
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = getKVBinding(env);
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const token = getBearerToken(request);
        if (!token) return jsonResponse({ error: 'No authorization token' }, 401, env, request);
        const session = await getSessionFromRequest(db, request);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);

        const repoBlocks = await loadBlocksFromRepo(env);
        const blocks = repoBlocks?.length ? repoBlocks : DEFAULT_BLOCKS;
        return jsonResponse({ blocks, source: repoBlocks?.length ? 'repository' : 'default' }, 200, env, request);
    } catch (err) {
        logError(err, 'Blocks/Get', env);
        return jsonResponse({ error: 'Failed to load blocks' }, 500, env, request);
    }
}

export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
