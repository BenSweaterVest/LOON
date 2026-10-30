/**
 * Reusable blocks: snippets of Markdown editors can insert into any page.
 */

import { del, get, post, put } from '../api.js';
import { confirmDialog, field, h, mount, openDialog, showError, timeAgo, toast } from '../dom.js';

export async function render(main) {
    const { blocks } = await get('/api/blocks');

    async function edit(block) {
        const name = h('input', { type: 'text', required: true, maxlength: 80, value: block?.name || '' });
        const body = h('textarea', { rows: 10, required: true, maxlength: 20000, class: 'code' });
        body.value = block?.body || '';
        const saved = await openDialog({
            title: block ? 'Edit block' : 'New block',
            wide: true,
            body: h('div', null, field('Name', name), field('Content (Markdown)', body, { help: 'Inserted as a copy; editing a block later does not change pages that already use it.' })),
            actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true, submit: true }],
            onSubmit: async () => {
                if (block) await put(`/api/blocks/${block.id}`, { name: name.value, body: body.value });
                else await post('/api/blocks', { name: name.value, body: body.value });
                return true;
            }
        });
        if (saved) {
            toast('Block saved');
            render(main);
        }
    }

    async function remove(block) {
        if (!(await confirmDialog('Delete block', `Delete “${block.name}”? Pages that already include it keep their copy.`, { confirmLabel: 'Delete', danger: true }))) return;
        try {
            await del(`/api/blocks/${block.id}`);
            render(main);
        } catch (err) { showError(err); }
    }

    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'Blocks'), h('button', { type: 'button', class: 'primary', onClick: () => edit(null) }, 'New block')),
        h('p', { class: 'muted' }, 'Reusable snippets such as contact details or opening hours. Insert them with the Block button in any formatted text field.'),
        h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Preview'), h('th', null, 'Updated'), h('th', null, ''))),
            h('tbody', null, blocks.length ? blocks.map((b) => h('tr', null,
                h('td', null, h('strong', null, b.name), h('div', { class: 'mono small muted' }, b.id)),
                h('td', { class: 'small muted' }, b.body.slice(0, 100)),
                h('td', { class: 'small' }, timeAgo(b.updatedAt), h('div', { class: 'muted' }, b.updatedBy)),
                h('td', { class: 'actions' },
                    h('button', { type: 'button', class: 'small', onClick: () => edit(b) }, 'Edit'),
                    h('button', { type: 'button', class: 'small danger', onClick: () => remove(b) }, 'Delete'))))
                : h('tr', null, h('td', { colspan: 4, class: 'empty' }, 'No blocks yet.'))))));
}
