/**
 * Reader feedback submitted from public pages.
 */

import { del, get, patch } from '../api.js';
import { confirmDialog, formatDate, h, mount, showError, timeAgo } from '../dom.js';

export async function render(main, statusArg) {
    const status = statusArg || 'open';
    const { feedback } = await get(`/api/feedback?status=${status}`);
    const tabs = h('div', { class: 'row' }, ['open', 'resolved', 'all'].map((s) => h('button', {
        type: 'button', class: `small${s === status ? ' primary' : ''}`, onClick: () => render(main, s)
    }, s[0].toUpperCase() + s.slice(1))));

    async function act(item, action) {
        try {
            if (action === 'delete') {
                if (!(await confirmDialog('Delete feedback', 'Delete this message permanently?', { confirmLabel: 'Delete', danger: true }))) return;
                await del(`/api/feedback/${item.id}`);
            } else {
                await patch(`/api/feedback/${item.id}`, { resolved: action === 'resolve' });
            }
            render(main, status);
        } catch (err) { showError(err); }
    }

    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'Feedback'), tabs),
        feedback.length ? feedback.map((f) => h('div', { class: 'panel' },
            h('div', { class: 'row' },
                h('a', { href: `#/pages/${f.pageId}` }, `/${f.pageId}/`),
                h('span', { class: 'muted small', title: formatDate(f.createdAt) }, timeAgo(f.createdAt)),
                f.resolvedAt ? h('span', { class: 'badge ok' }, `Resolved by ${f.resolvedBy}`) : null),
            h('p', null, f.message),
            f.contact ? h('p', { class: 'small' }, 'Contact: ', h('a', { href: `mailto:${f.contact}` }, f.contact)) : null,
            h('div', { class: 'row' },
                f.resolvedAt
                    ? h('button', { type: 'button', class: 'small', onClick: () => act(f, 'reopen') }, 'Reopen')
                    : h('button', { type: 'button', class: 'small primary', onClick: () => act(f, 'resolve') }, 'Mark resolved'),
                h('button', { type: 'button', class: 'small danger', onClick: () => act(f, 'delete') }, 'Delete'))))
            : h('div', { class: 'panel empty' }, status === 'open' ? 'No open feedback. Readers can send feedback from the bottom of each page.' : 'Nothing here.'));
}
