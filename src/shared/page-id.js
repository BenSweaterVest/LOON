/**
 * Page IDs double as URL paths (/<id>/), so they are short lowercase slugs
 * that cannot collide with LOON's own routes and assets.
 */

export const PAGE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const RESERVED_PAGE_IDS = new Set([
    'admin', 'api', 'assets', 'media', 'content', 'functions', 'templates',
    'index', 'favicon', 'robots', 'sitemap', 'feed', 'rss', '404', '500',
    'cdn-cgi', 'static', 'login', 'logout'
]);

export function isValidPageId(id) {
    return typeof id === 'string' && PAGE_ID_PATTERN.test(id) && !RESERVED_PAGE_IDS.has(id) && !id.includes('--');
}

export function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/g, '');
}
