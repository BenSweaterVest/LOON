/**
 * Media library grid, used by the Media view and as a picker dialog.
 */

import { formatBytes, h, mount, openDialog, showError, toast } from '../dom.js';
import { loadMedia, thumbnailUrl, uploadImage } from './media.js';

function lazyImage(media) {
    const img = h('img', { alt: media.alt || '', loading: 'lazy' });
    const holder = h('div', { class: 'img' }, img);
    const observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        thumbnailUrl(media).then((url) => { img.src = url; }).catch(() => { holder.textContent = 'Unavailable'; });
    });
    observer.observe(holder);
    return holder;
}

export function mediaCard(media, { onPick, selected } = {}) {
    const image = lazyImage(media);
    const label = `${media.alt || 'No alt text'} · ${formatBytes(media.size)}${media.publishedAt ? '' : ' · not yet published'}`;
    return h('div', { class: `media-card${selected ? ' selected' : ''}` },
        onPick ? h('button', { type: 'button', class: 'pick', title: 'Use this image', onClick: () => onPick(media) }, image) : image,
        h('div', { class: 'meta' }, label));
}

export function uploadZone(onUploaded) {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif', multiple: true, class: 'sr-only', id: `up-${Math.random().toString(36).slice(2)}` });
    const status = h('span', { class: 'small', role: 'status' });
    const zone = h('div', { class: 'dropzone' },
        h('p', null, 'Drop images here or ', h('label', { for: input.id, class: 'link' }, h('u', null, 'choose files')), '.'),
        h('p', { class: 'small' }, 'Images are resized to 1600px and compressed in your browser before upload.'),
        input, status);

    async function handle(files) {
        const uploaded = [];
        for (const [i, file] of [...files].entries()) {
            status.textContent = `Uploading ${i + 1} of ${files.length}…`;
            try {
                uploaded.push(await uploadImage(file));
            } catch (err) {
                showError(err);
            }
        }
        status.textContent = '';
        if (uploaded.length) {
            toast(`Uploaded ${uploaded.length} image(s)`);
            onUploaded(uploaded);
        }
    }
    input.addEventListener('change', () => { handle(input.files); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('over');
        handle([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
    });
    return zone;
}

/** Resolves with the chosen media record, or null. */
export function pickMedia() {
    return openDialog({
        title: 'Choose an image',
        wide: true,
        body: (form, close) => {
            const grid = h('div', { class: 'media-grid' }, h('p', { class: 'loading' }, 'Loading…'));
            loadMedia()
                .then((items) => mount(grid, items.length ? items.map((m) => mediaCard(m, { onPick: close })) : h('p', { class: 'muted' }, 'No images yet. Upload one above.')))
                .catch(showError);
            return h('div', null, uploadZone((uploaded) => close(uploaded[0])), grid);
        },
        actions: [{ label: 'Cancel', value: null }]
    });
}
