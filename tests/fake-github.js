/**
 * In-memory stand-in for the parts of the GitHub REST API LOON uses.
 * Install with `const gh = installFakeGitHub()`; inspect `gh.files` and `gh.commits`.
 */

import { vi } from 'vitest';

export function installFakeGitHub({ repo = 'owner/site', branch = 'main', canWrite = true } = {}) {
    let counter = 0;
    const sha = () => `sha${++counter}`;
    const blobs = new Map();
    const trees = new Map();
    const commits = new Map();
    const rootTree = sha();
    trees.set(rootTree, new Map());
    const rootCommit = sha();
    commits.set(rootCommit, { tree: rootTree, parents: [], message: 'init' });
    const refs = new Map([[branch, rootCommit]]);
    const state = { calls: [], commitLog: [], failNextRefUpdate: false };

    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const filesAt = (commitSha) => trees.get(commits.get(commitSha).tree);

    const fetchMock = vi.fn(async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        const method = init.method || 'GET';
        if (url.hostname !== 'api.github.com') throw new Error(`unexpected fetch ${url}`);
        state.calls.push(`${method} ${url.pathname}`);
        const prefix = `/repos/${repo}`;
        if (!url.pathname.startsWith(prefix)) return json({ message: 'Not Found' }, 404);
        const path = url.pathname.slice(prefix.length);
        const body = init.body ? JSON.parse(init.body) : null;

        if (path === '' && method === 'GET') return json({ full_name: repo, private: false });
        if (path === '/git/blobs' && method === 'POST') {
            if (!canWrite) return json({ message: 'Resource not accessible by personal access token' }, 403);
            const s = sha();
            blobs.set(s, body.encoding === 'base64' ? { base64: body.content } : { text: body.content });
            return json({ sha: s }, 201);
        }
        if (path === `/git/ref/heads/${branch}` && method === 'GET') return json({ object: { sha: refs.get(branch) } });
        if (path.startsWith('/git/commits/') && method === 'GET') {
            const c = commits.get(path.split('/').pop());
            return c ? json({ sha: path.split('/').pop(), tree: { sha: c.tree } }) : json({ message: 'Not Found' }, 404);
        }
        if (path === '/git/trees' && method === 'POST') {
            const next = new Map(trees.get(body.base_tree));
            for (const entry of body.tree) {
                if (entry.sha === null) {
                    if (!next.has(entry.path)) return json({ message: 'tree.path does not exist' }, 422);
                    next.delete(entry.path);
                } else if (entry.content !== undefined) {
                    next.set(entry.path, { text: entry.content });
                } else {
                    next.set(entry.path, blobs.get(entry.sha));
                }
            }
            const s = sha();
            trees.set(s, next);
            return json({ sha: s }, 201);
        }
        if (path === '/git/commits' && method === 'POST') {
            const s = sha();
            commits.set(s, { tree: body.tree, parents: body.parents, message: body.message });
            return json({ sha: s }, 201);
        }
        if (path === `/git/refs/heads/${branch}` && method === 'PATCH') {
            if (state.failNextRefUpdate) {
                state.failNextRefUpdate = false;
                // Simulate someone else pushing first.
                const other = sha();
                commits.set(other, { tree: commits.get(refs.get(branch)).tree, parents: [refs.get(branch)], message: 'concurrent' });
                refs.set(branch, other);
                return json({ message: 'Update is not a fast forward' }, 422);
            }
            const c = commits.get(body.sha);
            if (!c.parents.includes(refs.get(branch))) return json({ message: 'Update is not a fast forward' }, 422);
            refs.set(branch, body.sha);
            state.commitLog.push({ sha: body.sha, message: c.message });
            return json({ object: { sha: body.sha } });
        }
        if (path.startsWith('/contents/') && method === 'GET') {
            const dir = decodeURIComponent(path.slice('/contents/'.length));
            const entries = [...filesAt(refs.get(branch)).keys()]
                .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
                .map((p) => ({ path: p, name: p.split('/').pop(), type: 'file' }));
            return entries.length ? json(entries) : json({ message: 'Not Found' }, 404);
        }
        return json({ message: `fake: unhandled ${method} ${path}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    return {
        state,
        get files() {
            const out = {};
            for (const [p, v] of filesAt(refs.get(branch))) out[p] = v.text !== undefined ? v.text : { base64: v.base64 };
            return out;
        },
        get commits() {
            return state.commitLog;
        },
        env: { GITHUB_REPO: repo, GITHUB_TOKEN: 'test-token', GITHUB_BRANCH: branch }
    };
}
