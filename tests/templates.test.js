import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/templates.js';

function createRequest() {
    return new Request('http://localhost/api/templates');
}

describe('Templates Endpoint', () => {
    let env;

    beforeEach(() => {
        env = {
            GITHUB_REPO: 'test-owner/test-repo',
            GITHUB_TOKEN: 'test-token'
        };
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return 500 when GitHub is not configured', async () => {
        const response = await onRequestGet({ request: createRequest(), env: {} });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toContain('GitHub not configured');
    });

    it('should list templates from examples directory', async () => {
        const examplesList = [
            { type: 'dir', name: 'blog-post' },
            { type: 'dir', name: 'faq' }
        ];
        const blogSchema = Buffer.from(JSON.stringify({
            title: 'Blog',
            description: 'Blog template',
            fields: [{ key: 'title' }, { key: 'body' }]
        })).toString('base64');
        const faqSchema = Buffer.from(JSON.stringify({
            title: 'FAQ',
            description: 'FAQ template',
            fields: [{ key: 'question' }]
        })).toString('base64');

        global.fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(examplesList), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ content: blogSchema }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ content: faqSchema }), { status: 200 }));

        const response = await onRequestGet({ request: createRequest(), env });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.total).toBe(2);
        expect(body.templates[0].title).toBe('Blog');
        expect(body.templates[1].title).toBe('FAQ');
    });
});
