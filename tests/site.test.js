import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMarkdown, markdownToText } from '../src/shared/markdown.js';
import { renderArticle, renderPage } from '../src/shared/render.js';
import { DEFAULT_SETTINGS, validateSettings } from '../src/shared/site.js';
import { build } from '../scripts/build.mjs';

describe('markdown', () => {
    it('renders common syntax', () => {
        const { html, headings } = renderMarkdown('# Title\n\nSome **bold** and *italic* with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n\n```js\nlet x = 1 < 2;\n```');
        expect(html).toContain('<h1 id="title">Title</h1>');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<em>italic</em>');
        expect(html).toContain('<code>code</code>');
        expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
        expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
        expect(html).toContain('<blockquote><p>quote</p></blockquote>');
        expect(html).toContain('<hr>');
        expect(html).toContain('<pre><code class="language-js">let x = 1 &lt; 2;</code></pre>');
        expect(headings).toEqual([{ level: 1, text: 'Title', id: 'title' }]);
    });

    it('escapes HTML and blocks unsafe URLs', () => {
        const html = renderMarkdown('<img src=x onerror=alert(1)> [a](javascript:alert(1)) ![b](data:image/svg+xml,x) [ok](https://example.com) "quotes"').html;
        expect(html).not.toMatch(/<img src=x/);
        expect(html).not.toMatch(/href="javascript/);
        expect(html).not.toMatch(/src="data:/);
        expect(html).toContain('<a href="https://example.com" rel="noopener">ok</a>');
        expect(html).toContain('&quot;quotes&quot;');
    });

    it('cannot be broken out of attributes', () => {
        const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1)) ![y](/m.png" onerror="alert(1))').html;
        expect(html).not.toMatch(/"\s*onmouseover=/);
        expect(html).not.toMatch(/"\s*onerror=/);
    });

    it('renders tables, task lists, nested lists and line breaks', () => {
        const html = renderMarkdown('| Day | Hours |\n|---|---:|\n| Mon | 9-5 |\n\n- [x] done\n- [ ] todo\n  - nested\n\nline one\nline two').html;
        expect(html).toContain('<th class="align-right">Hours</th>');
        expect(html).toContain('class="task done"');
        expect(html).toContain('<ul><li>nested</li></ul>');
        expect(html).toContain('line one<br>\nline two');
    });

    it('extracts plain text', () => {
        expect(markdownToText('## Hello **world** [link](https://x.com)')).toBe('Hello world link');
        expect(markdownToText('word '.repeat(100), 20).length).toBeLessThanOrEqual(20);
    });
});

describe('page rendering', () => {
    const schema = {
        fields: [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'summary', label: 'Summary', type: 'textarea' },
            { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Closed'] },
            { key: 'hero', label: 'Hero', type: 'image' },
            { key: 'cta_label', label: 'CTA label', type: 'text' },
            { key: 'cta_url', label: 'CTA URL', type: 'url' },
            { key: 'phone', label: 'Phone', type: 'tel' },
            { key: 'starts', label: 'Starts', type: 'date' },
            { key: 'body', label: 'Body', type: 'markdown' },
            { key: 'items', label: 'Items', type: 'repeater', fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'price', label: 'Price', type: 'text' }] }
        ]
    };
    const data = {
        title: 'Taco <Truck>', summary: 'Best tacos', status: 'Open', hero: { src: '/media/0123456789abcdef.jpg', alt: 'Truck' },
        cta_label: 'Order', cta_url: 'https://order.example', phone: '(555) 010-0000', starts: '2026-03-01',
        body: '## One\n\n## Two\n\n## Three', items: [{ name: 'Al pastor', price: '$3' }]
    };

    it('derives layout from the schema', () => {
        const { html, title, description } = renderArticle({ title: 'Page', schema, data });
        expect(title).toBe('Taco <Truck>');
        expect(description).toBe('Best tacos');
        expect(html).toContain('<h1>Taco &lt;Truck&gt;</h1>');
        expect(html).toContain('<span class="badge badge-open">Open</span>');
        expect(html).toContain('<a class="button" href="https://order.example">Order</a>');
        expect(html).toContain('<a href="tel:5550100000">(555) 010-0000</a>');
        expect(html).toContain('March 1, 2026');
        expect(html).toContain('class="toc"');
        expect(html).toContain('<span class="price">$3</span>');
        expect(html).toContain('src="/media/0123456789abcdef.jpg"');
    });

    it('maps media URLs for previews', () => {
        const { html } = renderArticle({ title: 'P', schema, data }, { resolveUrl: (u) => (u.startsWith('/media/') ? `data:image/jpeg;base64,AAAA` : u) });
        expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    });

    it('produces a full document with SEO tags and navigation', () => {
        const { settings } = validateSettings({ ...DEFAULT_SETTINGS, siteName: 'Trucks', navigation: [{ label: 'Tacos', href: 'tacos' }, { label: 'Blog', href: 'https://blog.example' }] });
        const html = renderPage({ id: 'tacos', title: 'Tacos', schema, data, publishedAt: Date.UTC(2026, 0, 2) }, settings, { siteUrl: 'https://trucks.example' });
        expect(html).toContain('<title>Taco &lt;Truck&gt; | Trucks</title>');
        expect(html).toContain('<link rel="canonical" href="https://trucks.example/tacos/">');
        expect(html).toContain('<meta property="og:image" content="https://trucks.example/media/0123456789abcdef.jpg">');
        expect(html).toContain('<a href="/tacos/" aria-current="page">Tacos</a>');
        expect(html).toContain('<a href="https://blog.example">Blog</a>');
        expect(html).toContain('data-page="tacos"');
        expect(html).not.toMatch(/<script>|style="/);
    });
});

describe('static build', () => {
    function makeContent() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loon-content-'));
        fs.mkdirSync(path.join(dir, 'pages'));
        fs.mkdirSync(path.join(dir, 'media'));
        fs.writeFileSync(path.join(dir, 'media', '0123456789abcdef.png'), 'png');
        return dir;
    }

    it('builds an empty site with a welcome page', () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'loon-dist-'));
        const result = build({ outDir: out, contentDir: makeContent(), siteUrl: '' });
        expect(result.pages).toBe(0);
        expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('no published pages yet');
        expect(fs.existsSync(path.join(out, 'sitemap.xml'))).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(out, '_routes.json'), 'utf8')).include).toEqual(['/api/*']);
        expect(fs.readFileSync(path.join(out, '_headers'), 'utf8')).toContain("script-src 'self'");
        expect(fs.existsSync(path.join(out, 'assets', 'shared', 'render.js'))).toBe(true);
    });

    it('renders pages, home, media, sitemap and theme', () => {
        const content = makeContent();
        const page = (id, title) => ({ id, title, template: null, schema: { fields: [{ key: 'title', label: 'Title', type: 'text' }] }, data: { title }, version: 1, publishedAt: Date.UTC(2026, 1, 1) });
        fs.writeFileSync(path.join(content, 'pages', 'home.json'), JSON.stringify(page('home', 'Welcome')));
        fs.writeFileSync(path.join(content, 'pages', 'about.json'), JSON.stringify(page('about', 'About')));
        fs.writeFileSync(path.join(content, 'pages', 'bad.json'), JSON.stringify({ id: 'api', title: 'x' }));
        fs.writeFileSync(path.join(content, 'site.json'), JSON.stringify({ siteName: 'Club', homePage: 'home', accentColor: '#ff0000' }));
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'loon-dist-'));
        const result = build({ outDir: out, contentDir: content, siteUrl: 'https://club.example/' });
        expect(result).toMatchObject({ pages: 2, media: 1, home: 'home' });
        expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('<h1>Welcome</h1>');
        expect(fs.readFileSync(path.join(out, 'about', 'index.html'), 'utf8')).toContain('<h1>About</h1>');
        expect(fs.existsSync(path.join(out, 'media', '0123456789abcdef.png'))).toBe(true);
        const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
        expect(sitemap).toContain('<loc>https://club.example/</loc>');
        expect(sitemap).toContain('<loc>https://club.example/about/</loc>');
        expect(sitemap).not.toContain('/home/');
        expect(fs.readFileSync(path.join(out, 'assets', 'theme.css'), 'utf8')).toContain('#ff0000');
        expect(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8')).toContain('Sitemap: https://club.example/sitemap.xml');
    });
});
