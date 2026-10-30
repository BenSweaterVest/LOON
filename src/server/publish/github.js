/**
 * GitHub Git Data API client. Publishes any set of file changes as a single
 * commit, so one publish triggers exactly one Pages build.
 */

import { HttpError } from '../http.js';

const API = 'https://api.github.com';

export class GitHubError extends HttpError {
    constructor(status, message) {
        super(502, message, { githubStatus: status });
    }
}

async function request(config, method, path, body) {
    const init = {
        method,
        headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'LOON-CMS'
        }
    };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${API}/repos/${config.githubRepo}${path}`, init);
    if (res.ok) return res.status === 204 ? null : res.json();
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).message || text; } catch { /* keep text */ }
    const err = new GitHubError(res.status, `GitHub ${method} ${path} failed (${res.status}): ${message}`.slice(0, 500));
    err.githubStatus = res.status;
    throw err;
}

/**
 * Base64 strings contain no characters that need JSON escaping, so the body
 * is assembled by concatenation instead of JSON.stringify on a large string.
 */
function blobBody(base64) {
    return `{"encoding":"base64","content":"${base64}"}`;
}

async function listExisting(config, dir) {
    try {
        const entries = await request(config, 'GET', `/contents/${dir}?ref=${encodeURIComponent(config.githubBranch)}`);
        return new Set(Array.isArray(entries) ? entries.map((e) => e.path) : []);
    } catch (err) {
        if (err.githubStatus === 404) return new Set();
        throw err;
    }
}

/**
 * Commit changes in one go.
 *   changes: [{ path, text } | { path, base64 } | { path, delete: true }]
 * Returns the new commit SHA. Retries when the branch moved underneath us.
 */
export async function commitChanges(config, changes, message) {
    const deletions = changes.filter((c) => c.delete);
    let existing = null;
    if (deletions.length) {
        // Deleting a path that is not in the tree fails the whole commit.
        const dirs = [...new Set(deletions.map((c) => c.path.slice(0, c.path.lastIndexOf('/'))))];
        existing = new Set();
        for (const dir of dirs) for (const p of await listExisting(config, dir)) existing.add(p);
    }

    const blobShas = new Map();
    for (const change of changes) {
        if (change.base64 !== undefined) {
            const blob = await request(config, 'POST', '/git/blobs', blobBody(change.base64));
            blobShas.set(change.path, blob.sha);
        }
    }

    const tree = [];
    for (const change of changes) {
        if (change.delete) {
            if (existing.has(change.path)) tree.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
        } else if (change.base64 !== undefined) {
            tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blobShas.get(change.path) });
        } else {
            tree.push({ path: change.path, mode: '100644', type: 'blob', content: change.text });
        }
    }
    if (!tree.length) return null;

    const branch = encodeURIComponent(config.githubBranch);
    for (let attempt = 0; attempt < 3; attempt++) {
        const ref = await request(config, 'GET', `/git/ref/heads/${branch}`);
        const parent = await request(config, 'GET', `/git/commits/${ref.object.sha}`);
        const newTree = await request(config, 'POST', '/git/trees', { base_tree: parent.tree.sha, tree });
        const commit = await request(config, 'POST', '/git/commits', {
            message,
            tree: newTree.sha,
            parents: [ref.object.sha]
        });
        try {
            await request(config, 'PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
            return commit.sha;
        } catch (err) {
            // 422: not a fast-forward because someone else pushed. Rebuild on the new head.
            if (err.githubStatus !== 422 || attempt === 2) throw err;
        }
    }
    return null;
}

/**
 * Check that the token can write to the repository: read the branch, then
 * create a tiny unreferenced blob (which needs Contents: write).
 */
export async function checkAccess(config) {
    const result = { repoFound: false, branchExists: false, canWrite: false };
    try {
        await request(config, 'GET', '');
        result.repoFound = true;
        await request(config, 'GET', `/git/ref/heads/${encodeURIComponent(config.githubBranch)}`);
        result.branchExists = true;
        await request(config, 'POST', '/git/blobs', { content: 'loon access check', encoding: 'utf-8' });
        result.canWrite = true;
    } catch (err) {
        result.error = err.message;
    }
    result.ok = result.repoFound && result.branchExists && result.canWrite;
    return result;
}
