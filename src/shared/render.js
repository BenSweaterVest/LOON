/**
 * Render published pages to complete HTML documents. Used by the static build
 * and by the admin's live preview, so output is identical in both.
 *
 * Layout is derived from the schema: a title-like field becomes the headline,
 * a summary-like field the lede, a status choice a badge, the first image the
 * hero, label/url pairs become buttons, long text becomes sections and short
 * values a details list.
 */

import { escapeHtml, markdownToText, renderMarkdown } from './markdown.js';
import { isSafeUrl } from './schema.js';
import { navHref } from './site.js';

const HEADLINE_KEYS = ['headline', 'title', 'name', 'question'];
const LEDE_KEYS = ['subheadline', 'tagline', 'summary', 'excerpt', 'subtitle', 'message'];
const BADGE_KEYS = ['status', 'availability', 'urgency', 'level'];
const LONG_TYPES = new Set(['markdown', 'textarea']);
const PRIMARY_BODY_KEYS = ['body', 'content', 'description', 'answer'];

function isEmpty(value) {
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object' && 'src' in value) return !value.src;
    return false;
}

function pickField(fields, keys, types, data) {
    for (const key of keys) {
        const f = fields.find((field) => field.key === key && types.includes(field.type) && !isEmpty(data[field.key]));
        if (f) return f;
    }
    return null;
}

export function formatValue(field, value, lang) {
    try {
        switch (field.type) {
            case 'date':
                return new Date(`${value}T00:00:00Z`).toLocaleDateString(lang, { dateStyle: 'long', timeZone: 'UTC' });
            case 'time':
                return new Date(`1970-01-01T${value}:00Z`).toLocaleTimeString(lang, { timeStyle: 'short', timeZone: 'UTC' });
            case 'datetime':
                return new Date(`${value}:00Z`).toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
            case 'number':
                return new Intl.NumberFormat(lang).format(value);
            case 'checkbox':
                return value ? 'Yes' : 'No';
            default:
                return String(value);
        }
    } catch {
        return String(value);
    }
}

function valueHtml(field, value, ctx) {
    const text = escapeHtml(formatValue(field, value, ctx.lang));
    if (field.type === 'email') return `<a href="mailto:${escapeHtml(value)}">${text}</a>`;
    if (field.type === 'tel') return `<a href="tel:${escapeHtml(String(value).replace(/[^\d+]/g, ''))}">${text}</a>`;
    if (field.type === 'url' && isSafeUrl(value)) {
        const display = /^https?:\/\//i.test(value) ? value.replace(/^https?:\/\//i, '').replace(/\/$/, '') : value;
        return `<a href="${escapeHtml(value)}"${/^https?:/i.test(value) ? ' rel="noopener"' : ''}>${escapeHtml(display)}</a>`;
    }
    return text;
}

function imageHtml(image, ctx, className = '') {
    if (!isSafeUrl(image.src)) return '';
    const src = ctx.resolveUrl(image.src);
    return `<figure${className ? ` class="${className}"` : ''}><img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt || '')}" loading="lazy" decoding="async"></figure>`;
}

function markdownHtml(source, ctx, minLevel) {
    const { html, headings } = renderMarkdown(source, { resolveUrl: ctx.resolveUrl, minLevel });
    return { html, headings };
}

function repeaterHtml(field, entries, ctx) {
    const sub = field.fields;
    const titleField = pickField(sub, HEADLINE_KEYS, ['text'], {}) || sub.find((f) => f.type === 'text');
    const isFaq = sub.some((f) => f.key === 'question') && sub.some((f) => f.key === 'answer');
    const items = entries.map((entry) => {
        const title = titleField && !isEmpty(entry[titleField.key]) ? escapeHtml(entry[titleField.key]) : '';
        const rest = sub.filter((f) => f !== titleField && !isEmpty(entry[f.key]));
        const long = rest.filter((f) => LONG_TYPES.has(f.type)).map((f) => markdownHtml(entry[f.key], ctx, 4).html).join('');
        const images = rest.filter((f) => f.type === 'image').map((f) => imageHtml(entry[f.key], ctx, 'entry-image')).join('');
        const lists = rest.filter((f) => f.type === 'list').map((f) => `<ul>${entry[f.key].map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`).join('');
        const short = rest.filter((f) => !LONG_TYPES.has(f.type) && !['image', 'list'].includes(f.type));
        const price = short.find((f) => /price|cost|fee/.test(f.key));
        const meta = short.filter((f) => f !== price).map((f) => `<span class="meta-item"><span class="meta-label">${escapeHtml(f.label)}:</span> ${valueHtml(f, entry[f.key], ctx)}</span>`).join('');
        if (isFaq) {
            return `<details class="entry faq"><summary>${title}</summary>${long}${meta ? `<p class="meta">${meta}</p>` : ''}</details>`;
        }
        return `<article class="entry">${images}<div class="entry-body">${title || price ? `<h3>${title}${price ? `<span class="price">${valueHtml(price, entry[price.key], ctx)}</span>` : ''}</h3>` : ''}${meta ? `<p class="meta">${meta}</p>` : ''}${long}${lists}</div></article>`;
    });
    return `<div class="entries${isFaq ? ' faq-list' : ''}">${items.join('')}</div>`;
}

/**
 * Render the article body for a page. Returns { html, title, description, image }.
 */
export function renderArticle(page, options = {}) {
    const ctx = { lang: options.lang || 'en', resolveUrl: options.resolveUrl || ((u) => u) };
    const fields = page.schema?.fields || [];
    const data = page.data || {};
    const used = new Set();

    const headlineField = pickField(fields, HEADLINE_KEYS, ['text'], data)
        || fields.find((f) => f.type === 'text' && /name$/.test(f.key) && !isEmpty(data[f.key]));
    const headline = headlineField ? data[headlineField.key] : page.title;
    if (headlineField) used.add(headlineField.key);

    const ledeField = pickField(fields, LEDE_KEYS, ['text', 'textarea'], data);
    if (ledeField) used.add(ledeField.key);

    const badgeField = pickField(fields, BADGE_KEYS, ['select'], data);
    if (badgeField) used.add(badgeField.key);

    const heroField = fields.find((f) => f.type === 'image' && !isEmpty(data[f.key]));
    if (heroField) used.add(heroField.key);

    const ctas = [];
    for (const f of fields) {
        if (f.type !== 'url' || isEmpty(data[f.key]) || !f.key.endsWith('_url')) continue;
        const labelKey = `${f.key.slice(0, -4)}_label`;
        const labelField = fields.find((l) => l.key === labelKey);
        if (labelField && !isEmpty(data[labelKey])) {
            ctas.push({ href: data[f.key], label: data[labelKey], primary: ctas.length === 0 });
            used.add(f.key);
            used.add(labelKey);
        }
    }

    const sections = [];
    const details = [];
    let toc = [];
    for (const f of fields) {
        if (used.has(f.key) || isEmpty(data[f.key])) continue;
        const value = data[f.key];
        if (LONG_TYPES.has(f.type)) {
            const primary = PRIMARY_BODY_KEYS.includes(f.key) && !sections.some((s) => s.primary);
            const { html, headings } = markdownHtml(value, ctx, primary ? 2 : 3);
            if (primary) toc = headings.filter((h) => h.level === 2);
            sections.push({ primary, html: primary ? `<div class="prose">${html}</div>` : `<section class="section"><h2>${escapeHtml(f.label)}</h2><div class="prose">${html}</div></section>` });
        } else if (f.type === 'list') {
            sections.push({ html: `<section class="section"><h2>${escapeHtml(f.label)}</h2><ul class="tags">${value.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul></section>` });
        } else if (f.type === 'repeater') {
            sections.push({ html: `<section class="section"><h2>${escapeHtml(f.label)}</h2>${repeaterHtml(f, value, ctx)}</section>` });
        } else if (f.type === 'image') {
            sections.push({ html: imageHtml(value, ctx) });
        } else {
            details.push(`<div class="detail"><dt>${escapeHtml(f.label)}</dt><dd>${valueHtml(f, value, ctx)}</dd></div>`);
        }
    }

    const badge = badgeField
        ? `<span class="badge badge-${escapeHtml(String(data[badgeField.key]).toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(data[badgeField.key])}</span>`
        : '';
    const lede = ledeField ? `<p class="lede">${escapeHtml(data[ledeField.key]).replace(/\n/g, '<br>')}</p>` : '';
    const buttons = ctas.length
        ? `<p class="actions">${ctas.filter((c) => isSafeUrl(c.href)).map((c) => `<a class="button${c.primary ? '' : ' secondary'}" href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`).join('')}</p>`
        : '';
    const tocHtml = toc.length >= 3
        ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${toc.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`
        : '';
    const primary = sections.filter((s) => s.primary).map((s) => s.html).join('');
    const others = sections.filter((s) => !s.primary).map((s) => s.html).join('');

    const html = [
        `<header class="hero">${badge}<h1>${escapeHtml(headline)}</h1>${lede}${buttons}</header>`,
        heroField ? imageHtml(data[heroField.key], ctx, 'hero-image') : '',
        details.length ? `<dl class="details">${details.join('')}</dl>` : '',
        tocHtml,
        primary,
        others
    ].join('\n');

    const bodyField = fields.find((f) => LONG_TYPES.has(f.type) && !isEmpty(data[f.key]));
    const description = ledeField ? markdownToText(data[ledeField.key]) : bodyField ? markdownToText(data[bodyField.key]) : '';
    const image = heroField ? data[heroField.key] : null;
    return { html, title: String(headline), description, image };
}

function navHtml(settings, currentId) {
    if (!settings.navigation?.length) return '';
    const links = settings.navigation.map((item) => {
        const href = navHref(item.href);
        const current = item.href === currentId ? ' aria-current="page"' : '';
        return `<li><a href="${escapeHtml(href)}"${current}>${escapeHtml(item.label)}</a></li>`;
    });
    return `<nav class="site-nav" aria-label="Main"><ul>${links.join('')}</ul></nav>`;
}

/**
 * Wrap body HTML in the site chrome (header, navigation, footer).
 */
export function renderDocument({ settings, title, description = '', bodyHtml, currentId = null, canonical = null, image = null, assetBase = '/assets', footerNote = '', scripts = true, noindex = false }) {
    const siteName = settings.siteName || 'LOON';
    const fullTitle = title && title !== siteName ? `${title} | ${siteName}` : siteName;
    const footer = settings.footer ? renderMarkdown(settings.footer, { minLevel: 3 }).html : '';
    const imageUrl = image?.src && canonical ? new URL(image.src, canonical).href : null;
    const head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(fullTitle)}</title>`,
        description ? `<meta name="description" content="${escapeHtml(description)}">` : '',
        canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : '',
        noindex ? '<meta name="robots" content="noindex">' : '',
        `<meta property="og:title" content="${escapeHtml(title || siteName)}">`,
        `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
        description ? `<meta property="og:description" content="${escapeHtml(description)}">` : '',
        canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : '',
        imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '',
        '<link rel="icon" href="/favicon.png" type="image/png">',
        `<link rel="stylesheet" href="${assetBase}/site.css">`,
        `<link rel="stylesheet" href="${assetBase}/theme.css">`,
        scripts ? `<script type="module" src="${assetBase}/site.js"></script>` : ''
    ].filter(Boolean).join('\n    ');

    return `<!doctype html>
<html lang="${escapeHtml(settings.language || 'en')}">
<head>
    ${head}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
    <div class="wrap">
        <a class="brand" href="/">${escapeHtml(siteName)}</a>
        ${settings.tagline ? `<span class="tagline">${escapeHtml(settings.tagline)}</span>` : ''}
        ${navHtml(settings, currentId)}
    </div>
</header>
<main id="main" class="wrap">
${bodyHtml}
</main>
<footer class="site-footer">
    <div class="wrap">
        ${footer}
        ${footerNote ? `<p class="footer-note">${footerNote}</p>` : ''}
    </div>
</footer>
</body>
</html>
`;
}

export function themeCss(settings) {
    const accent = /^#[0-9a-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '#2563eb';
    return `:root { --accent: ${accent}; }\n`;
}

/**
 * Full HTML for one published page.
 */
export function renderPage(page, settings, options = {}) {
    const lang = settings.language || 'en';
    const article = renderArticle(page, { lang, resolveUrl: options.resolveUrl });
    const updated = page.publishedAt
        ? `Updated <time datetime="${new Date(page.publishedAt).toISOString()}">${escapeHtml(new Date(page.publishedAt).toLocaleDateString(lang, { dateStyle: 'long' }))}</time>`
        : '';
    const feedback = settings.feedback && options.feedback !== false
        ? `<section class="feedback" data-page="${escapeHtml(page.id)}" hidden>
    <details>
        <summary>Spotted a problem or have a suggestion?</summary>
        <form class="feedback-form">
            <label>Message <textarea name="message" required maxlength="2000" rows="4"></textarea></label>
            <label>Your email (optional) <input name="contact" type="email" maxlength="200" autocomplete="email"></label>
            <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
            <button type="submit">Send feedback</button>
            <p class="feedback-status" role="status"></p>
        </form>
    </details>
</section>`
        : '';
    return renderDocument({
        settings,
        title: article.title,
        description: article.description,
        image: article.image,
        currentId: page.id,
        canonical: options.siteUrl ? `${options.siteUrl}${options.isHome ? '/' : `/${page.id}/`}` : null,
        assetBase: options.assetBase,
        scripts: options.scripts,
        noindex: options.noindex,
        footerNote: updated,
        bodyHtml: `<article class="page page-${escapeHtml(page.template || 'custom')}">\n${article.html}\n</article>\n${feedback}`
    });
}
