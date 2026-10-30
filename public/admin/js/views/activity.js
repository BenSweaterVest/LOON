/**
 * Activity: changes by others on watched pages, plus the full audit log for admins.
 */

import { get } from '../api.js';
import { formatDate, h, mount, timeAgo } from '../dom.js';
import { hasRole } from '../state.js';

const ACTIONS = {
    'page.create': 'created', 'page.save': 'saved', 'page.publish': 'published', 'page.unpublish': 'unpublished',
    'page.delete': 'deleted', 'page.restore': 'restored an older version of', 'page.rollback': 'rolled back',
    'page.submit': 'submitted for review', 'page.withdraw': 'withdrew from review', 'page.reject': 'sent back',
    'page.schedule': 'scheduled', 'page.unschedule': 'cancelled the schedule for', 'page.schedule_failed': 'could not auto-publish'
};

function describe(entry) {
    const verb = ACTIONS[entry.action] || entry.action;
    return [h('strong', null, entry.actor || 'scheduler'), ` ${verb} `, h('a', { href: `#/pages/${entry.pageId}` }, entry.pageId),
        entry.details?.note ? h('span', { class: 'muted' }, ` · “${entry.details.note}”`) : null];
}

export async function render(main) {
    const { pages, activity } = await get('/api/watches');
    const sections = [
        h('div', { class: 'page-head' }, h('h1', null, 'Activity')),
        h('div', { class: 'panel' },
            h('h2', null, 'Watched pages'),
            pages.length
                ? h('p', null, pages.map((p, i) => [i ? ', ' : '', h('a', { href: `#/pages/${p.pageId}` }, p.title || p.pageId)]))
                : h('p', { class: 'muted' }, 'You are not watching any pages. Use Watch in the editor to follow changes by others.'),
            activity.length
                ? h('ul', { class: 'revisions' }, activity.map((a) => h('li', null, h('span', null, describe(a)), h('span', { class: 'muted small', title: formatDate(a.at) }, timeAgo(a.at)))))
                : pages.length ? h('p', { class: 'muted' }, 'No recent changes by others.') : null)
    ];
    if (hasRole('admin')) sections.push(await auditPanel());
    mount(main, ...sections);
}

async function auditPanel() {
    const body = h('tbody');
    const more = h('button', { type: 'button', class: 'small', hidden: true }, 'Load more');
    const actor = h('input', { type: 'search', placeholder: 'User', 'aria-label': 'Filter by user' });
    const action = h('input', { type: 'search', placeholder: 'Action (e.g. auth.login_failed)', 'aria-label': 'Filter by action' });
    let before = null;

    async function load(reset) {
        if (reset) { before = null; mount(body); }
        const params = new URLSearchParams({ limit: '50' });
        if (actor.value.trim()) params.set('actor', actor.value.trim().toLowerCase());
        if (action.value.trim()) params.set('action', action.value.trim());
        if (before) params.set('before', before);
        const { entries, nextBefore } = await get(`/api/audit?${params}`);
        for (const e of entries) {
            body.append(h('tr', null,
                h('td', { class: 'small nowrap', title: formatDate(e.at) }, timeAgo(e.at)),
                h('td', null, e.actor || '-'),
                h('td', { class: 'mono' }, e.action),
                h('td', { class: 'mono small' }, e.target || ''),
                h('td', { class: 'small muted' }, e.details ? JSON.stringify(e.details).slice(0, 120) : ''),
                h('td', { class: 'small muted mono' }, e.ip || '')));
        }
        if (!body.children.length) body.append(h('tr', null, h('td', { colspan: 6, class: 'empty' }, 'No entries.')));
        before = nextBefore;
        more.hidden = entries.length < 50;
    }
    more.addEventListener('click', () => load(false));
    for (const input of [actor, action]) input.addEventListener('change', () => load(true));
    await load(true);
    return h('div', { class: 'panel' },
        h('h2', null, 'Audit log'),
        h('p', { class: 'muted small' }, 'Everything people did in LOON, kept for 90 days by default (AUDIT_RETENTION_DAYS).'),
        h('div', { class: 'row' }, actor, action),
        h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, ['When', 'User', 'Action', 'Target', 'Details', 'IP'].map((t) => h('th', null, t)))),
            body)),
        more);
}
