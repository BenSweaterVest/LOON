/**
 * Page list: filter, create, bulk publish.
 */

import { get, post, errorLines } from '../api.js';
import { confirmDialog, field, formatDate, h, mount, openDialog, showError, timeAgo, toast } from '../dom.js';
import { hasRole } from '../state.js';
import { navigate } from '../nav.js';
import { slugify, isValidPageId } from '/assets/shared/page-id.js';

export function statusBadges(page) {
    const badges = [];
    if (page.status === 'published') badges.push(h('span', { class: 'badge ok' }, 'Published'));
    else if (page.status === 'modified') badges.push(h('span', { class: 'badge warn', title: 'The live page is older than the draft' }, 'Unpublished changes'));
    else badges.push(h('span', { class: 'badge' }, 'Draft'));
    if (page.workflow === 'review') badges.push(h('span', { class: 'badge info' }, 'In review'));
    if (page.scheduledFor) badges.push(h('span', { class: 'badge info', title: formatDate(page.scheduledFor) }, `Scheduled ${timeAgo(page.scheduledFor)}`));
    return badges;
}

export async function render(main) {
    const [{ pages }, { templates }] = await Promise.all([get('/api/pages'), get('/api/templates')]);
    const editor = hasRole('editor');
    const selected = new Set();

    const search = h('input', { type: 'search', placeholder: 'Search pages', 'aria-label': 'Search pages' });
    const filter = h('select', { 'aria-label': 'Filter by status' },
        h('option', { value: '' }, 'All pages'),
        h('option', { value: 'draft' }, 'Never published'),
        h('option', { value: 'modified' }, 'Unpublished changes'),
        h('option', { value: 'published' }, 'Published'),
        h('option', { value: 'review' }, 'In review'),
        h('option', { value: 'scheduled' }, 'Scheduled'));
    const publishButton = h('button', { type: 'button', class: 'primary', disabled: true, onClick: publishSelected }, 'Publish selected');
    const tbody = h('tbody');
    const table = h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
            editor ? h('th', { class: 'nowrap' }, h('span', { class: 'sr-only' }, 'Select')) : null,
            h('th', null, 'Page'), h('th', null, 'Status'), h('th', null, 'Last edited'))),
        tbody));

    function visible() {
        const q = search.value.trim().toLowerCase();
        const f = filter.value;
        return pages.filter((p) => {
            if (q && !p.title.toLowerCase().includes(q) && !p.id.includes(q)) return false;
            if (f === 'review') return p.workflow === 'review';
            if (f === 'scheduled') return !!p.scheduledFor;
            return !f || p.status === f;
        });
    }

    function draw() {
        mount(tbody);
        const list = visible();
        if (!list.length) {
            tbody.append(h('tr', null, h('td', { colspan: editor ? 4 : 3, class: 'empty' },
                pages.length ? 'No pages match.' : 'No pages yet. Create your first one.')));
        }
        for (const page of list) {
            const checkbox = editor ? h('input', {
                type: 'checkbox', checked: selected.has(page.id), 'aria-label': `Select ${page.title}`,
                onClick: (e) => e.stopPropagation(),
                onChange: (e) => {
                    if (e.target.checked) selected.add(page.id); else selected.delete(page.id);
                    publishButton.disabled = !selected.size;
                    publishButton.textContent = selected.size ? `Publish ${selected.size} selected` : 'Publish selected';
                }
            }) : null;
            tbody.append(h('tr', { class: 'clickable', onClick: () => navigate(`/pages/${page.id}`) },
                editor ? h('td', null, checkbox) : null,
                h('td', null, h('a', { href: `#/pages/${page.id}` }, page.title), h('div', { class: 'muted small mono' }, `/${page.id}/`)),
                h('td', null, h('div', { class: 'row' }, statusBadges(page))),
                h('td', { class: 'small' }, timeAgo(page.updatedAt), h('div', { class: 'muted' }, page.updatedBy))));
        }
    }

    async function publishSelected() {
        const ids = [...selected];
        const ok = await confirmDialog('Publish pages', `Publish the current drafts of ${ids.length} page(s)? The live site updates in about a minute.`, { confirmLabel: 'Publish' });
        if (!ok) return;
        publishButton.disabled = true;
        try {
            await post('/api/publish', { pages: ids });
            toast(`Published ${ids.length} page(s). The site will update shortly.`);
            render(main);
        } catch (err) {
            showError(err);
            publishButton.disabled = false;
        }
    }

    search.addEventListener('input', draw);
    filter.addEventListener('change', draw);

    mount(main,
        h('div', { class: 'page-head' },
            h('h1', null, 'Pages'),
            h('div', { class: 'actions' },
                editor ? publishButton : null,
                h('button', { type: 'button', class: editor ? '' : 'primary', onClick: () => newPageDialog(templates) }, 'New page'))),
        h('div', { class: 'row' }, search, filter),
        h('div', { class: 'stack' }, table));
    draw();
}

export async function newPageDialog(templates) {
    let template = '';
    let idTouched = false;
    const title = h('input', { type: 'text', required: true, maxlength: 200 });
    const id = h('input', { id: 'new-id', type: 'text', required: true, maxlength: 64, pattern: '[a-z0-9](?:[a-z0-9\\-]{0,62}[a-z0-9])?', class: 'mono' });
    const idHelp = h('p', { class: 'help' }, 'Used in the address: /your-id/. Lowercase letters, numbers and hyphens.');
    title.addEventListener('input', () => { if (!idTouched) id.value = slugify(title.value); });
    id.addEventListener('input', () => { idTouched = true; });

    const cards = [];
    const choose = (value, card) => {
        template = value;
        cards.forEach((c) => c.classList.toggle('selected', c === card));
    };
    const blank = h('button', { type: 'button', class: 'template-card selected' }, h('strong', null, 'Blank page'), h('span', null, 'A title and a formatted body.'));
    blank.addEventListener('click', () => choose('', blank));
    cards.push(blank);
    for (const t of templates) {
        const card = h('button', { type: 'button', class: 'template-card' }, h('strong', null, t.title), h('span', null, t.description));
        card.addEventListener('click', () => choose(t.id, card));
        cards.push(card);
    }

    const result = await openDialog({
        title: 'New page',
        wide: true,
        body: h('div', null,
            field('Title', title, { required: true }),
            h('div', { class: 'field' }, h('label', { for: 'new-id' }, 'Page ID', h('span', { class: 'req' }, '*')), id, idHelp),
            h('div', { class: 'field' }, h('label', null, 'Start from'), h('div', { class: 'template-grid' }, cards))),
        actions: [{ label: 'Cancel', value: null }, { label: 'Create page', value: 'create', primary: true, submit: true }],
        onSubmit: async () => {
            if (!isValidPageId(id.value)) throw new Error('That page ID is not allowed. Use lowercase letters, numbers and single hyphens, and avoid reserved words like admin or api.');
            try {
                const { page } = await post('/api/pages', { id: id.value, title: title.value, template: template || undefined });
                return page.id;
            } catch (err) {
                throw new Error([err.message, ...errorLines(err)].join(' '));
            }
        }
    });
    if (result) navigate(`/pages/${result}`);
}
