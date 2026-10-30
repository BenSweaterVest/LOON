import { describe, it, expect } from 'vitest';
import { Client, createEnv, signedIn } from './helpers.js';
import { validateContent, validateSchema, isSafeUrl } from '../src/shared/schema.js';
import { isValidPageId, slugify } from '../src/shared/page-id.js';

describe('schema validation', () => {
    it('normalizes fields and reports problems', () => {
        const { schema, errors } = validateSchema({
            fields: [
                { key: 'title', label: 'Title', type: 'text', required: true, maxlength: 50 },
                { key: 'title', type: 'text' },
                { key: 'Bad Key', type: 'text' },
                { key: 'size', type: 'select', options: [] },
                { key: 'menu', type: 'repeater', fields: [{ key: 'name', type: 'text' }, { key: 'inner', type: 'repeater', fields: [] }] }
            ]
        });
        expect(schema.fields[0]).toMatchObject({ key: 'title', maxLength: 50, required: true });
        expect(errors.join('\n')).toMatch(/duplicate key "title"/);
        expect(errors.join('\n')).toMatch(/must start with a letter/);
        expect(errors.join('\n')).toMatch(/at least one option/);
        expect(errors.join('\n')).toMatch(/cannot be nested/);
    });

    it('validates and cleans content', () => {
        const { schema } = validateSchema({
            fields: [
                { key: 'title', label: 'Title', type: 'text', required: true },
                { key: 'link', label: 'Link', type: 'url' },
                { key: 'price', label: 'Price', type: 'number', min: 0 },
                { key: 'open', label: 'Open', type: 'checkbox' },
                { key: 'when', label: 'When', type: 'date' },
                { key: 'hero', label: 'Hero', type: 'image' },
                { key: 'items', label: 'Items', type: 'repeater', fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] }
            ]
        });
        const ok = validateContent(schema, { title: 'Hi', link: '/about/', price: '4.5', open: true, when: '2026-02-28', hero: '/media/abc.jpg', extra: 'dropped', items: [{ name: 'Taco' }] });
        expect(ok.errors).toEqual([]);
        expect(ok.data).toEqual({ title: 'Hi', link: '/about/', price: 4.5, open: true, when: '2026-02-28', hero: { src: '/media/abc.jpg', alt: '' }, items: [{ name: 'Taco' }] });

        const bad = validateContent(schema, { link: 'javascript:alert(1)', price: -1, when: '2026-02-30' });
        expect(bad.errors.map((e) => e.path)).toEqual(['link', 'price', 'when']);

        const draftOk = validateContent(schema, { items: [{}] });
        expect(draftOk.errors).toEqual([]);
        const publishCheck = validateContent(schema, { items: [{}] }, { requireAll: true });
        expect(publishCheck.errors.map((e) => e.path)).toEqual(['title', 'items[0].name']);
    });

    it('only allows safe URLs', () => {
        for (const url of ['https://x.org', '/page/', '#top', 'mailto:a@b.co', 'tel:+1555']) expect(isSafeUrl(url)).toBe(true);
        for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'JaVaScRiPt:x', 'https://a b']) expect(isSafeUrl(url)).toBe(false);
    });

    it('validates page IDs and slugs', () => {
        expect(isValidPageId('food-trucks')).toBe(true);
        expect(isValidPageId('admin')).toBe(false);
        expect(isValidPageId('-x')).toBe(false);
        expect(isValidPageId('a--b')).toBe(false);
        expect(slugify('Café Menu & Hours!')).toBe('cafe-menu-hours');
    });

    it('ships templates that validate', async () => {
        const { TEMPLATES } = await import('../templates/index.js');
        for (const [id, t] of Object.entries(TEMPLATES)) {
            const { schema, errors } = validateSchema(t.schema);
            expect(errors, id).toEqual([]);
            expect(validateContent(schema, t.sample).errors, id).toEqual([]);
        }
    });
});

describe('pages API', () => {
    it('creates from a template, saves with version checks, and records revisions', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        const created = await editor.post('/api/pages', { id: 'tacos', title: 'Taco Truck', template: 'food-truck' });
        expect(created.status).toBe(200);
        const page = created.data.page;
        expect(page).toMatchObject({ id: 'tacos', status: 'draft', version: 1, template: 'food-truck' });
        expect(page.data.name).toBe('Taco Express');

        const saved = await editor.put('/api/pages/tacos', { baseVersion: 1, data: { ...page.data, status: 'Closed' } });
        expect(saved.status).toBe(200);
        expect(saved.data.page.version).toBe(2);

        const stale = await editor.put('/api/pages/tacos', { baseVersion: 1, data: page.data });
        expect(stale.status).toBe(409);
        expect(stale.data.details).toMatchObject({ code: 'version_conflict', currentVersion: 2, updatedBy: 'eddie' });

        // Saves within ten minutes by the same person share one revision.
        await editor.put('/api/pages/tacos', { baseVersion: 2, data: { ...page.data, status: 'Open' } });
        const revs = (await editor.get('/api/pages/tacos/revisions')).data.revisions;
        expect(revs.map((r) => [r.kind, r.version])).toEqual([['save', 3], ['create', 1]]);

        const restored = await editor.post(`/api/pages/tacos/revisions/${revs[1].id}/restore`, { baseVersion: 3 });
        expect(restored.status).toBe(200);
        expect(restored.data.page.data.status).toBe('Open');
        expect(restored.data.page.version).toBe(4);
    });

    it('rejects invalid content and bad IDs', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        expect((await editor.post('/api/pages', { id: 'api', title: 'X' })).status).toBe(400);
        expect((await editor.post('/api/pages', { id: 'Has Spaces', title: 'X' })).status).toBe(400);
        await editor.post('/api/pages', { id: 'about', title: 'About' });
        expect((await editor.post('/api/pages', { id: 'about', title: 'Again' })).status).toBe(409);
        const res = await editor.put('/api/pages/about', { baseVersion: 1, data: { title: 42 } });
        expect(res.status).toBe(400);
        expect(res.data.details[0].path).toBe('title');
    });

    it('isolates contributors to their own pages and blocks schema changes', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'editors-page', title: 'Editor page' });
        const contrib = await signedIn(env, 'cara', 'contributor');
        expect((await contrib.post('/api/pages', { id: 'caras-page', title: 'Mine' })).status).toBe(200);
        expect((await contrib.get('/api/pages')).data.pages.map((p) => p.id)).toEqual(['caras-page']);
        expect((await contrib.get('/api/pages/editors-page')).status).toBe(404);
        expect((await contrib.put('/api/pages/caras-page', { baseVersion: 1, schema: { fields: [] } })).status).toBe(403);
        expect((await contrib.post('/api/pages', { id: 'custom', title: 'C', schema: { fields: [] } })).status).toBe(403);
        expect((await contrib.delete('/api/pages/caras-page')).status).toBe(403);
        expect((await editor.get('/api/pages')).data.pages).toHaveLength(2);
    });

    it('runs the review workflow', async () => {
        const env = await createEnv();
        const contrib = await signedIn(env, 'cara', 'contributor');
        await contrib.post('/api/pages', { id: 'news', title: 'News' });
        expect((await contrib.post('/api/pages/news/workflow', { action: 'submit' })).data.page.workflow).toBe('review');
        expect((await contrib.post('/api/pages/news/workflow', { action: 'reject' })).status).toBe(403);
        const editor = await signedIn(env, 'eddie', 'editor');
        const rejected = await editor.post('/api/pages/news/workflow', { action: 'reject', note: 'Needs a photo' });
        expect(rejected.data.page.workflow).toBe('draft');
        expect((await editor.post('/api/pages/news/workflow', { action: 'withdraw' })).status).toBe(409);
    });

    it('duplicates and deletes pages', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'menu', title: 'Menu', template: 'menu-page' });
        const copy = await editor.post('/api/pages/menu/duplicate', { id: 'menu-2' });
        expect(copy.data.page).toMatchObject({ id: 'menu-2', title: 'Menu (copy)', template: 'menu-page' });
        expect((await editor.delete('/api/pages/menu-2')).status).toBe(200);
        expect((await editor.get('/api/pages/menu-2')).status).toBe(404);
    });

    it('lists templates', async () => {
        const env = await createEnv();
        const contrib = await signedIn(env, 'cara', 'contributor');
        const { templates } = (await contrib.get('/api/templates')).data;
        expect(templates.length).toBeGreaterThanOrEqual(20);
    });
});

describe('blocks, watches and feedback', () => {
    it('manages reusable blocks', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        const created = await editor.post('/api/blocks', { name: 'Contact Info', body: 'Call us at 555-0100' });
        expect(created.data.block.id).toBe('contact-info');
        await editor.put('/api/blocks/contact-info', { body: 'Call 555-0199' });
        const contrib = await signedIn(env, 'cara', 'contributor');
        expect((await contrib.get('/api/blocks')).data.blocks[0].body).toBe('Call 555-0199');
        expect((await contrib.post('/api/blocks', { name: 'X', body: 'y' })).status).toBe(403);
    });

    it('shows activity on watched pages by other people', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'hours', title: 'Hours' });
        const other = await signedIn(env, 'olive', 'editor');
        await other.put('/api/watches/hours');
        await editor.put('/api/pages/hours', { baseVersion: 1, title: 'Opening hours' });
        const { pages, activity } = (await other.get('/api/watches')).data;
        expect(pages[0]).toMatchObject({ pageId: 'hours', title: 'Opening hours' });
        expect(activity.map((a) => a.action)).toEqual(['page.save', 'page.create']);
    });

    it('accepts feedback only for published pages and lets editors resolve it', async () => {
        const env = await createEnv();
        const editor = await signedIn(env, 'eddie', 'editor');
        await editor.post('/api/pages', { id: 'faq', title: 'FAQ' });
        const visitor = new Client(env, { ip: '8.8.8.8' });
        expect((await visitor.post('/api/feedback', { pageId: 'faq', message: 'Typo' })).status).toBe(400);
        await env.DB.prepare("UPDATE pages SET published = '{}' WHERE id = 'faq'").run();
        expect((await visitor.post('/api/feedback', { pageId: 'faq', message: 'Typo in answer 2' })).status).toBe(200);
        expect((await visitor.post('/api/feedback', { pageId: 'faq', message: 'spam', website: 'http://spam' })).status).toBe(200);
        const list = (await editor.get('/api/feedback')).data.feedback;
        expect(list).toHaveLength(1);
        await editor.patch(`/api/feedback/${list[0].id}`, { resolved: true });
        expect((await editor.get('/api/feedback')).data.feedback).toHaveLength(0);
        expect((await editor.get('/api/feedback?status=resolved')).data.feedback).toHaveLength(1);
    });
});
