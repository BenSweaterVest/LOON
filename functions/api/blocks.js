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

async function validateSession(db, request) {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    const raw = await db.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw);
}

async function loadBlocksFromRepo(env) {
    const path = 'data/_blocks/blocks.json';
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LOON-CMS/1.0'
        }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(atob(data.content));
    if (!Array.isArray(parsed)) return null;
    return parsed
        .filter(item => item && item.id && item.label && typeof item.content === 'string')
        .map(item => ({ id: String(item.id), label: String(item.label), content: String(item.content) }));
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = env.LOON_DB || env.KV;
    if (!db) return jsonResponse({ error: 'KV not configured' }, 500, env, request);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ error: 'GitHub not configured' }, 500, env, request);

    try {
        const session = await validateSession(db, request);
        if (!session) return jsonResponse({ error: 'Authentication required' }, 401, env, request);

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

