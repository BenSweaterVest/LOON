import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deleteRepoFile,
    getRepoApiJson,
    getRepoFileJson,
    listRepoDirectory,
    putRepoFileJson,
    repoPathExists
} from '../functions/lib/github.js';

function createEnv() {
    return {
        GITHUB_REPO: 'test-owner/test-repo',
        GITHUB_TOKEN: 'test-token'
    };
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('GitHub Helper', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getRepoFileJson should return parsed content when file exists', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
            sha: 'sha1',
            content: encodeJson({ title: 'Demo' })
        }), { status: 200 }));

        const file = await getRepoFileJson(createEnv(), 'data/demo/content.json');
        expect(file.exists).toBe(true);
        expect(file.sha).toBe('sha1');
        expect(file.content.title).toBe('Demo');
    });

    it('getRepoFileJson should return exists=false on 404', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
        const file = await getRepoFileJson(createEnv(), 'data/missing/content.json');
        expect(file.exists).toBe(false);
        expect(file.content).toBeNull();
    });

    it('listRepoDirectory should return null on 404', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
        const data = await listRepoDirectory(createEnv(), 'data');
        expect(data).toBeNull();
    });

    it('repoPathExists should return true when path is available', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
        const exists = await repoPathExists(createEnv(), 'data/demo');
        expect(exists).toBe(true);
    });

    it('putRepoFileJson should return commit sha', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
            commit: { sha: 'commit123' }
        }), { status: 200 }));

        const sha = await putRepoFileJson(createEnv(), 'data/demo/content.json', { title: 'x' }, 'msg', 'sha1');
        expect(sha).toBe('commit123');
    });

    it('deleteRepoFile should return not found when target is missing', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
        const result = await deleteRepoFile(createEnv(), 'data/demo/content.json', 'delete');
        expect(result.success).toBe(false);
    });

    it('getRepoApiJson should support allow404', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
        const data = await getRepoApiJson(createEnv(), 'commits?path=x', { allow404: true });
        expect(data).toBeNull();
    });
});
