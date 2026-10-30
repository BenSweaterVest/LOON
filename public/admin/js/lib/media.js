/**
 * Media helpers: client-side resizing and encoding, uploads, and URL
 * resolution for previews. Published images are served as static files;
 * unpublished ones are fetched once from the API and shown as data URLs.
 */

import { api, get } from '../api.js';

export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const MAX_DIMENSION = 1600;

let index = null;
const dataUrls = new Map();
const pending = new Map();
const listeners = new Set();

export function onMediaReady(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export async function loadMedia(force = false) {
    if (!index || force) {
        const { media } = await get('/api/media');
        index = new Map(media.map((m) => [m.filename, m]));
    }
    return [...index.values()];
}

function filenameOf(src) {
    const m = /^\/media\/([a-f0-9]{16}\.[a-z]+)$/.exec(src || '');
    return m ? m[1] : null;
}

async function fetchDataUrl(file) {
    const meta = index?.get(file);
    const res = await fetch(`/api/media/${file.split('.')[0]}/data`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Image unavailable');
    const mime = res.headers.get('X-Media-Type') || meta?.mime || 'image/jpeg';
    return `data:${mime};base64,${await res.text()}`;
}

/**
 * Synchronous resolver for the renderer. Returns the best URL available now
 * and loads unpublished images in the background, notifying listeners.
 */
export function resolveMediaUrl(src) {
    const file = filenameOf(src);
    if (!file) return src;
    if (dataUrls.has(file)) return dataUrls.get(file);
    if (!pending.has(file)) {
        pending.set(file, fetchDataUrl(file)
            .then((url) => {
                dataUrls.set(file, url);
                listeners.forEach((fn) => fn(file));
            })
            .catch(() => { /* leave the static URL in place */ })
            .finally(() => pending.delete(file)));
    }
    const meta = index?.get(file);
    return meta?.publishedAt ? src : 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
}

/** URL for thumbnails in the library: static if published, else data URL. */
export async function thumbnailUrl(media) {
    if (media.publishedAt) return media.url;
    if (!dataUrls.has(media.filename)) dataUrls.set(media.filename, await fetchDataUrl(media.filename));
    return dataUrls.get(media.filename);
}

function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function encodeCanvas(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize to at most 1600px and re-encode (WebP when supported, else JPEG).
 * GIFs are kept as-is to preserve animation.
 */
export async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
        throw new Error(`${file.name}: only JPEG, PNG, WebP, GIF and AVIF images are supported`);
    }
    if (file.type === 'image/gif') {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name}: GIFs must be under 1.5 MB`);
        const bitmap = await createImageBitmap(file);
        const base64 = (await readAsDataUrl(file)).split(',')[1];
        return { base64, width: bitmap.width, height: bitmap.height };
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);

    let blob = null;
    for (const quality of [0.82, 0.7, 0.55]) {
        blob = await encodeCanvas(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') blob = await encodeCanvas(canvas, 'image/jpeg', quality);
        if (blob.size <= MAX_UPLOAD_BYTES) break;
    }
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name}: still over 1.5 MB after resizing`);
    const base64 = (await readAsDataUrl(blob)).split(',')[1];
    return { base64, width, height };
}

export async function uploadImage(file, alt = '') {
    const { base64, width, height } = await prepareImage(file);
    const params = new URLSearchParams({ filename: file.name.slice(0, 200), width, height, alt });
    const { media } = await api('POST', `/api/media?${params}`, base64, { raw: true, headers: { 'Content-Type': 'text/plain' } });
    if (!index) index = new Map();
    index.set(media.filename, media);
    dataUrls.set(media.filename, `data:${media.mime};base64,${base64}`);
    return media;
}
