/**
 * Media library: upload, alt text, delete.
 */

import { del, patch } from '../api.js';
import { confirmDialog, field, formatBytes, formatDate, h, mount, openDialog, showError, toast } from '../dom.js';
import { hasRole } from '../state.js';
import { loadMedia, thumbnailUrl } from '../lib/media.js';
import { mediaCard, uploadZone } from '../lib/media-picker.js';

export async function render(main) {
    const grid = h('div', { class: 'media-grid' });

    async function draw(force = false) {
        const items = await loadMedia(force);
        mount(grid, items.length
            ? items.map((m) => mediaCard(m, { onPick: () => details(m) }))
            : h('p', { class: 'muted' }, 'No images yet.'));
    }

    async function details(media) {
        const alt = h('input', { type: 'text', value: media.alt, maxlength: 300 });
        const preview = h('img', { alt: '' });
        thumbnailUrl(media).then((url) => { preview.src = url; }).catch(() => {});
        const snippet = `![${media.alt}](${media.url})`;
        const result = await openDialog({
            title: 'Image details',
            wide: true,
            body: h('div', { class: 'grid-2' },
                h('div', null, preview),
                h('div', null,
                    field('Alt text', alt, { help: 'Describe what the image shows for people using screen readers.' }),
                    h('dl', { class: 'kv small' },
                        h('dt', null, 'Size'), h('dd', null, `${formatBytes(media.size)}${media.width ? ` · ${media.width}×${media.height}` : ''}`),
                        h('dt', null, 'Uploaded'), h('dd', null, `${formatDate(media.createdAt)} by ${media.createdBy}`),
                        h('dt', null, 'Status'), h('dd', null, media.publishedAt ? `Published ${formatDate(media.publishedAt)}` : 'Not yet published (goes live with the first page that uses it)'),
                        h('dt', null, 'Address'), h('dd', { class: 'mono' }, media.url)),
                    h('button', { type: 'button', class: 'small', onClick: async () => {
                        try { await navigator.clipboard.writeText(snippet); toast('Markdown copied'); } catch { toast(snippet); }
                    } }, 'Copy Markdown'))),
            actions: [
                hasRole('editor') ? { label: 'Delete', value: 'delete', danger: true } : null,
                { label: 'Cancel', value: null },
                { label: 'Save', value: 'save', primary: true }
            ].filter(Boolean)
        });
        try {
            if (result === 'save' && alt.value !== media.alt) {
                await patch(`/api/media/${media.id}`, { alt: alt.value });
                toast('Saved');
                await draw(true);
            }
            if (result === 'delete' && await confirmDialog('Delete image', 'Delete this image? Pages must stop using it first.', { confirmLabel: 'Delete', danger: true })) {
                await del(`/api/media/${media.id}`);
                toast('Image deleted');
                await draw(true);
            }
        } catch (err) {
            const pages = err.details?.pages;
            showError(pages ? { message: `${err.message}: ${pages.join(', ')}` } : err);
        }
    }

    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'Media')),
        uploadZone(() => draw(true)),
        grid);
    await draw(true);
}
