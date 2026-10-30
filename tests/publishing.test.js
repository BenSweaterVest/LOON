import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client, createEnv, signedIn } from './helpers.js';
import { installFakeGitHub } from './fake-github.js';

afterEach(() => vi.unstubAllGlobals());

// 1x1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup(envOverrides = {}) {
    const gh = installFakeGitHub();
    const env = await createEnv({ ...gh.env, ...envOverrides });
    const editor = await signedIn(env, 'eddie', 'editor');
    return { gh, env, editor };
}

describe('publishing', () => {
    it('publishes drafts as one commit and never exposes drafts', async () => {
        const { gh, editor } = await setup();
        await editor.post('/api/pages', { id: 'tacos', title: 'Tacos', template: 'food-truck' });
        await editor.post('/api/pages', { id: 'about', title: 'About' });
        await editor.put('/api/pages/about', { baseVersion: 1, data: { title: 'About us', body: 'Hello' } });

        const res = await editor.post('/api/publish', { pages: [{ id: 'tacos', version: 1 }, 'about'] });
        expect(res.status).toBe(200);
        expect(gh.commits).toHaveLength(1);
        expect(gh.commits[0].message).toMatch(/^Publish 2 pages by eddie/);
        const file = JSON.parse(gh.files['content/pages/about.json']);
        expect(file).toMatchObject({ id: 'about', title: 'About', data: { title: 'About us', body: 'Hello' }, version: 2, publishedBy: 'eddie' });

        // A later draft edit stays in D1 until the next publish.
        await editor.put('/api/pages/about', { baseVersion: 2, data: { title: 'About us', body: 'Secret draft' } });
        expect(gh.files['content/pages/about.json']).not.toMatch(/Secret draft/);
        const page = (await editor.get('/api/pages/about')).data.page;
        expect(page.status).toBe('modified');
        expect(page.published.version).toBe(2);
    });

    it('refuses to publish incomplete pages or stale versions', async () => {
        const { gh, editor } = await setup();
        await editor.post('/api/pages', { id: 'empty', title: 'Empty' });
        await editor.put('/api/pages/empty', { baseVersion: 1, data: { title: '', body: '' } });
        const res = await editor.post('/api/publish', { pages: ['empty'] });
        expect(res.status).toBe(400);
        expect(res.data.details[0]).toMatchObject({ path: 'title', pageId: 'empty', required: true });
        expect((await editor.post('/api/publish', { pages: [{ id: 'empty', version: 1 }] })).status).toBe(409);
        expect(gh.commits).toHaveLength(0);
    });

    it('is editor-only', async () => {
        const { env } = await setup();
        const contrib = await signedIn(env, 'cara', 'contributor');
        await contrib.post('/api/pages', { id: 'mine', title: 'Mine' });
        expect((await contrib.post('/api/publish', { pages: ['mine'] })).status).toBe(403);
    });

    it('unpublishes by deleting the file, and delete unpublishes first', async () => {
        const { gh, editor } = await setup();
        await editor.post('/api/pages', { id: 'news', title: 'News' });
        await editor.post('/api/publish', { pages: ['news'] });
        expect(gh.files['content/pages/news.json']).toBeDefined();
        await editor.post('/api/unpublish', { pages: ['news'] });
        expect(gh.files['content/pages/news.json']).toBeUndefined();
        expect((await editor.get('/api/pages/news')).data.page.status).toBe('draft');

        await editor.post('/api/publish', { pages: ['news'] });
        await editor.delete('/api/pages/news');
        expect(gh.files['content/pages/news.json']).toBeUndefined();
        expect(gh.commits.map((c) => c.message.split('\n')[0])).toEqual([
            'Publish news by eddie', 'Unpublish news by eddie', 'Publish news by eddie', 'Unpublish news by eddie'
        ]);
    });

    it('retries when the branch moves during a publish', async () => {
        const { gh, editor } = await setup();
        await editor.post('/api/pages', { id: 'race', title: 'Race' });
        gh.state.failNextRefUpdate = true;
        expect((await editor.post('/api/publish', { pages: ['race'] })).status).toBe(200);
        expect(gh.files['content/pages/race.json']).toBeDefined();
    });

    it('commits referenced media with the page that uses it', async () => {
        const { gh, editor } = await setup();
        const upload = await editor.request('POST', '/api/media?filename=dot.png&width=1&height=1', { raw: PNG, headers: { 'Content-Type': 'text/plain' } });
        expect(upload.status).toBe(200);
        const { url, filename } = upload.data.media;
        expect(url).toMatch(/^\/media\/[a-f0-9]{16}\.png$/);
        expect((await editor.request('POST', '/api/media', { raw: PNG })).data.duplicate).toBe(true);

        await editor.post('/api/pages', { id: 'gallery', title: 'Gallery', template: 'landing-page' });
        const page = (await editor.get('/api/pages/gallery')).data.page;
        await editor.put('/api/pages/gallery', { baseVersion: 1, data: { ...page.data, hero_image: { src: url, alt: 'A dot' } } });
        await editor.post('/api/publish', { pages: ['gallery'] });
        expect(gh.files[`content/media/${filename}`]).toEqual({ base64: PNG });

        // Already-published media is not re-uploaded.
        await editor.put('/api/pages/gallery', { baseVersion: 2, title: 'Gallery 2' });
        await editor.post('/api/publish', { pages: ['gallery'] });
        expect(gh.state.calls.filter((c) => c.endsWith('/git/blobs'))).toHaveLength(1);

        expect((await editor.delete(`/api/media/${upload.data.media.id}`)).status).toBe(409);
    });

    it('rejects non-image uploads', async () => {
        const { editor } = await setup();
        const res = await editor.request('POST', '/api/media', { raw: btoa('<svg onload=alert(1)>') });
        expect(res.status).toBe(400);
    });

    it('rolls back to a previously published version', async () => {
        const { gh, editor } = await setup();
        await editor.post('/api/pages', { id: 'hours', title: 'Hours' });
        await editor.put('/api/pages/hours', { baseVersion: 1, data: { title: 'Hours', body: 'Mon-Fri' } });
        await editor.post('/api/publish', { pages: ['hours'] });
        await editor.put('/api/pages/hours', { baseVersion: 2, data: { title: 'Hours', body: 'Closed forever' } });
        await editor.post('/api/publish', { pages: ['hours'] });

        const revs = (await editor.get('/api/pages/hours/revisions')).data.revisions;
        const first = revs.filter((r) => r.kind === 'publish').at(-1);
        const res = await editor.post('/api/pages/hours/rollback', { revisionId: first.id, baseVersion: 3 });
        expect(res.status).toBe(200);
        expect(JSON.parse(gh.files['content/pages/hours.json']).data.body).toBe('Mon-Fri');
        expect(res.data.page).toMatchObject({ status: 'published', version: 4 });
    });

    it('saves and publishes site settings', async () => {
        const { gh, env } = await setup();
        const admin = await signedIn(env, 'root', 'admin');
        const bad = await admin.put('/api/settings', { navigation: [{ label: 'X', href: 'javascript:alert(1)' }] });
        expect(bad.status).toBe(400);
        const ok = await admin.put('/api/settings', { siteName: 'Capitol Food Trucks', navigation: [{ label: 'Menu', href: 'menu' }] });
        expect(ok.status).toBe(200);
        expect(JSON.parse(gh.files['content/site.json'])).toMatchObject({ siteName: 'Capitol Food Trucks', navigation: [{ label: 'Menu', href: 'menu' }] });
        expect((await admin.get('/api/settings')).data.settings.siteName).toBe('Capitol Food Trucks');
    });

    it('republishes everything from D1', async () => {
        const { gh, env, editor } = await setup();
        await editor.post('/api/pages', { id: 'one', title: 'One' });
        await editor.post('/api/pages', { id: 'two', title: 'Two' });
        await editor.post('/api/publish', { pages: ['one', 'two'] });
        const admin = await signedIn(env, 'root', 'admin');
        const res = await admin.post('/api/republish');
        expect(res.data).toMatchObject({ pages: 2 });
        expect(Object.keys(gh.files).sort()).toEqual(['content/pages/one.json', 'content/pages/two.json', 'content/site.json']);
    });
});

describe('scheduling', () => {
    it('publishes due pages from the cron endpoint', async () => {
        const { gh, env, editor } = await setup({ CRON_SECRET: 'cron-secret' });
        await editor.post('/api/pages', { id: 'later', title: 'Later' });
        expect((await editor.put('/api/pages/later/schedule', { at: Date.now() - 1000 })).status).toBe(400);
        await editor.put('/api/pages/later/schedule', { at: Date.now() + 60_000 });
        await env.DB.prepare('UPDATE pages SET scheduled_for = ? WHERE id = ?').bind(Date.now() - 1, 'later').run();

        const anon = new Client(env);
        expect((await anon.request('POST', '/api/cron', { headers: { Authorization: 'Bearer wrong' }, origin: null })).status).toBe(401);
        const res = await anon.request('POST', '/api/cron', { headers: { Authorization: 'Bearer cron-secret' }, origin: null });
        expect(res.status).toBe(200);
        expect(res.data.published).toEqual([{ id: 'later', ok: true, commit: expect.any(String) }]);
        expect(JSON.parse(gh.files['content/pages/later.json']).publishedBy).toBe('scheduler');
        expect((await editor.get('/api/pages/later')).data.page.scheduledFor).toBeNull();
    });

    it('also runs due schedules when an editor lists pages', async () => {
        const { gh, env, editor } = await setup();
        await editor.post('/api/pages', { id: 'soon', title: 'Soon' });
        await env.DB.prepare('UPDATE pages SET scheduled_for = ? WHERE id = ?').bind(Date.now() - 1, 'soon').run();
        await editor.get('/api/pages');
        expect(gh.files['content/pages/soon.json']).toBeDefined();
    });

    it('clears schedules that fail validation', async () => {
        const { env, editor } = await setup({ CRON_SECRET: 's' });
        await editor.post('/api/pages', { id: 'broken', title: 'Broken' });
        await editor.put('/api/pages/broken', { baseVersion: 1, data: { title: '' } });
        await env.DB.prepare('UPDATE pages SET scheduled_for = ? WHERE id = ?').bind(Date.now() - 1, 'broken').run();
        const res = await new Client(env).request('POST', '/api/cron', { headers: { Authorization: 'Bearer s' }, origin: null });
        expect(res.data.published[0].ok).toBe(false);
        expect((await editor.get('/api/pages/broken')).data.page.scheduledFor).toBeNull();
    });
});

describe('without GitHub', () => {
    it('publishes to D1 only in development', async () => {
        const env = await createEnv({ LOON_ENV: 'development' });
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'local', title: 'Local' });
        const res = await editor.post('/api/publish', { pages: ['local'] });
        expect(res.data.commit).toBeNull();
        expect((await editor.get('/api/pages/local')).data.page.status).toBe('published');
    });

    it('explains missing configuration in production', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'prod', title: 'Prod' });
        const res = await editor.post('/api/publish', { pages: ['prod'] });
        expect(res.status).toBe(503);
        expect(res.data.error).toMatch(/GITHUB_TOKEN/);
    });
});

describe('admin tools', () => {
    it('reports diagnostics including GitHub write access', async () => {
        const { env } = await setup();
        const admin = await signedIn(env, 'root', 'admin');
        const res = await admin.get('/api/diagnostics?github=1');
        expect(res.data.github).toMatchObject({ ok: true, canWrite: true });
        expect(res.data.checks.find((c) => c.id === 'cron').ok).toBe(false);
    });

    it('backs up and restores into a fresh instance', async () => {
        const { env, editor } = await setup();
        const admin = await signedIn(env, 'root', 'admin');
        await editor.post('/api/pages', { id: 'keep', title: 'Keep me' });
        const { tables } = (await admin.get('/api/backup')).data;
        const backup = {};
        for (const { table } of tables) backup[table] = (await admin.get(`/api/backup/${table}`)).data.rows;

        const fresh = await createEnv();
        const client = new Client(fresh);
        for (const table of ['settings', 'blocks', 'pages', 'revisions', 'media', 'feedback', 'audit']) {
            const res = await client.post('/api/setup/restore', { setupToken: fresh.SETUP_TOKEN, table, rows: backup[table] });
            expect(res.status, table).toBe(200);
        }
        const final = await client.post('/api/setup/restore', {
            setupToken: fresh.SETUP_TOKEN, table: 'users', rows: backup.users,
            passkeys: backup.passkeys, recovery_codes: backup.recovery_codes, watches: backup.watches
        });
        expect(final.status).toBe(200);
        expect((await client.post('/api/setup/restore', { setupToken: fresh.SETUP_TOKEN, table: 'pages', rows: [] })).status).toBe(409);

        const restoredEditor = new Client(fresh);
        await restoredEditor.login('eddie');
        expect((await restoredEditor.get('/api/pages/keep')).data.page.title).toBe('Keep me');
    });
});
