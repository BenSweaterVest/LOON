/**
 * Build an editing form from a page schema. Controls write straight into a
 * shared data object and call onChange after each edit.
 */

import { get } from '../api.js';
import { h, mount, openDialog, showError, toast } from '../dom.js';
import { pickMedia } from './media-picker.js';
import { resolveMediaUrl, onMediaReady } from './media.js';
import { IMPORT_ACCEPT, importDocument } from './import.js';

let uid = 0;
const nextId = () => `fld-${++uid}`;

const INPUT_TYPES = {
    text: 'text', email: 'email', url: 'url', tel: 'tel', number: 'number',
    date: 'date', time: 'time', datetime: 'datetime-local'
};

function emptyValue(field) {
    if (field.type === 'checkbox') return false;
    if (field.type === 'list' || field.type === 'repeater') return [];
    if (field.type === 'image') return { src: '', alt: '' };
    return '';
}

function wrapper(field, path, control, controlId) {
    return h('div', { class: 'field', dataset: { path } },
        field.type === 'checkbox' ? null : h('label', { for: controlId }, field.label, field.required ? h('span', { class: 'req', title: 'Required to publish' }, '*') : null),
        control,
        field.description ? h('p', { class: 'help' }, field.description) : null,
        h('p', { class: 'error', hidden: true }));
}

function insertAround(textarea, before, after = before, placeholder = 'text') {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const selected = value.slice(s, e) || placeholder;
    textarea.setRangeText(`${before}${selected}${after}`, s, e, 'end');
    textarea.setSelectionRange(s + before.length, s + before.length + selected.length);
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function prefixLines(textarea, prefix) {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const block = value.slice(lineStart, lineEnd).split('\n')
        .map((line, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + line.replace(/^(#{1,6}\s|[-*]\s|\d+\.\s|>\s)/, ''))
        .join('\n');
    textarea.setRangeText(block, lineStart, lineEnd, 'end');
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertText(textarea, text) {
    const { selectionStart: s, selectionEnd: e } = textarea;
    textarea.setRangeText(text, s, e, 'end');
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function chooseBlock() {
    const { blocks } = await get('/api/blocks');
    if (!blocks.length) {
        toast('No reusable blocks yet. Editors can add them under Blocks.');
        return null;
    }
    return openDialog({
        title: 'Insert a block',
        body: (form, close) => h('div', { class: 'stack' }, blocks.map((b) => h('div', { class: 'panel' },
            h('strong', null, b.name),
            h('p', { class: 'muted small' }, b.body.slice(0, 160)),
            h('button', { type: 'button', class: 'small', onClick: () => close(b) }, 'Insert')))),
        actions: [{ label: 'Cancel', value: null }]
    });
}

function markdownControl(field, value, onInput, id) {
    const textarea = h('textarea', { id, rows: field.rows || 8, placeholder: field.placeholder || '', maxlength: field.maxLength || null, class: 'markdown-input' });
    textarea.value = value || '';
    textarea.addEventListener('input', () => onInput(textarea.value));
    const fileInput = h('input', { type: 'file', accept: IMPORT_ACCEPT, class: 'sr-only' });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const md = await importDocument(file);
            if (textarea.value.trim()) {
                const mode = await openDialog({
                    title: 'Import document',
                    body: h('p', null, `Add the contents of ${file.name} to this field?`),
                    actions: [{ label: 'Cancel', value: null }, { label: 'Append', value: 'append' }, { label: 'Replace', value: 'replace', primary: true }]
                });
                if (!mode) return;
                textarea.value = mode === 'append' ? `${textarea.value.trimEnd()}\n\n${md}` : md;
            } else {
                textarea.value = md;
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            toast(`Imported ${file.name}`);
        } catch (err) {
            showError(err);
        }
    });
    const tool = (label, title, action) => h('button', { type: 'button', title, 'aria-label': title, onClick: action }, label);
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': `${field.label} formatting` },
        tool('B', 'Bold', () => insertAround(textarea, '**')),
        tool('I', 'Italic', () => insertAround(textarea, '*')),
        tool('H2', 'Heading', () => prefixLines(textarea, '## ')),
        tool('H3', 'Subheading', () => prefixLines(textarea, '### ')),
        tool('• List', 'Bulleted list', () => prefixLines(textarea, '- ')),
        tool('1. List', 'Numbered list', () => prefixLines(textarea, (i) => `${i + 1}. `)),
        tool('❝', 'Quote', () => prefixLines(textarea, '> ')),
        tool('Link', 'Link', () => {
            const { selectionStart: s, selectionEnd: e, value: v } = textarea;
            const text = v.slice(s, e) || 'link text';
            textarea.setRangeText(`[${text}](https://)`, s, e, 'end');
            const urlStart = s + text.length + 3;
            textarea.setSelectionRange(urlStart, urlStart + 8);
            textarea.focus();
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }),
        tool('Image', 'Insert image', async () => {
            const media = await pickMedia();
            if (media) insertText(textarea, `![${media.alt || ''}](${media.url})`);
        }),
        tool('Block', 'Insert reusable block', async () => {
            try {
                const block = await chooseBlock();
                if (block) insertText(textarea, block.body);
            } catch (err) { showError(err); }
        }),
        tool('Import…', 'Import a Word, OpenDocument, HTML or text file', () => fileInput.click()),
        fileInput);
    textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); insertAround(textarea, '**'); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); insertAround(textarea, '*'); }
    });
    return h('div', null, toolbar, textarea);
}

function imageControl(field, value, onInput, id) {
    const current = { src: value?.src || '', alt: value?.alt || '' };
    const thumb = h('div', { class: 'thumb' });
    const alt = h('input', { type: 'text', id, placeholder: 'Describe the image for screen readers', maxlength: 300 });
    alt.value = current.alt;
    const url = h('input', { type: 'url', placeholder: 'or paste an image address (https://…)' });
    url.value = current.src.startsWith('/media/') ? '' : current.src;
    const remove = h('button', { type: 'button', class: 'small danger', onClick: () => set({ src: '', alt: '' }) }, 'Remove');

    function drawThumb() {
        mount(thumb, current.src ? h('img', { src: current.src.startsWith('/media/') ? resolveMediaUrl(current.src) : current.src, alt: '' }) : 'No image');
        remove.hidden = !current.src;
    }
    function set(next) {
        Object.assign(current, next);
        alt.value = current.alt;
        url.value = current.src.startsWith('/media/') ? '' : current.src;
        drawThumb();
        onInput({ ...current });
    }
    const stop = onMediaReady(() => { if (!thumb.isConnected) stop(); else drawThumb(); });
    alt.addEventListener('input', () => { current.alt = alt.value; onInput({ ...current }); });
    url.addEventListener('change', () => set({ src: url.value.trim() }));
    drawThumb();
    return h('div', { class: 'image-field' }, thumb, h('div', { class: 'image-controls' },
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'small', onClick: async () => {
                const media = await pickMedia();
                if (media) set({ src: media.url, alt: current.alt || media.alt || '' });
            } }, current.src ? 'Change image' : 'Choose image'),
            remove),
        alt, url));
}

function listControl(field, value, onInput) {
    const items = Array.isArray(value) ? [...value] : [];
    const box = h('div', { class: 'list-editor' });
    const draw = () => {
        mount(box, items.map((item, i) => {
            const input = h('input', { type: 'text', value: item, maxlength: 500, 'aria-label': `${field.label} ${i + 1}` });
            input.addEventListener('input', () => { items[i] = input.value; onInput([...items]); });
            return h('div', { class: 'list-row' }, input,
                h('button', { type: 'button', class: 'icon small', title: 'Remove', 'aria-label': 'Remove', onClick: () => { items.splice(i, 1); draw(); onInput([...items]); } }, '✕'));
        }), h('button', { type: 'button', class: 'small', onClick: () => { items.push(''); draw(); onInput([...items]); box.querySelector('.list-row:last-of-type input')?.focus(); } }, '+ Add item'));
    };
    draw();
    return box;
}

function repeaterControl(field, value, onInput, path, ctx) {
    const items = Array.isArray(value) ? value.map((v) => ({ ...v })) : [];
    const box = h('div', { class: 'repeater' });
    const itemLabel = field.itemLabel || 'Entry';
    const titleKey = field.fields.find((f) => f.type === 'text')?.key;
    const emit = () => onInput(items.map((i) => ({ ...i })));
    const draw = (openIndex = -1) => {
        mount(box, items.map((item, i) => {
            const summaryText = h('span', null, (titleKey && item[titleKey]) || `${itemLabel} ${i + 1}`);
            const move = (delta) => {
                const j = i + delta;
                if (j < 0 || j >= items.length) return;
                [items[i], items[j]] = [items[j], items[i]];
                draw(j);
                emit();
            };
            const actions = h('span', { class: 'item-actions' },
                h('button', { type: 'button', class: 'icon small', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onClick: (e) => { e.preventDefault(); move(-1); } }, '↑'),
                h('button', { type: 'button', class: 'icon small', title: 'Move down', 'aria-label': 'Move down', disabled: i === items.length - 1, onClick: (e) => { e.preventDefault(); move(1); } }, '↓'),
                h('button', { type: 'button', class: 'icon small danger', title: 'Remove', 'aria-label': 'Remove', onClick: (e) => { e.preventDefault(); items.splice(i, 1); draw(); emit(); } }, '✕'));
            const body = h('div', { class: 'item-body' }, field.fields.map((sub) => fieldControl(sub, item, `${path}[${i}].${sub.key}`, () => {
                if (sub.key === titleKey) summaryText.textContent = item[titleKey] || `${itemLabel} ${i + 1}`;
                emit();
            }, ctx)));
            return h('details', { class: 'repeater-item', open: i === openIndex || items.length <= 3 }, h('summary', null, summaryText, actions), body);
        }), h('button', { type: 'button', class: 'small', onClick: () => {
            const entry = {};
            for (const sub of field.fields) entry[sub.key] = emptyValue(sub);
            items.push(entry);
            draw(items.length - 1);
            emit();
        } }, `+ Add ${itemLabel.toLowerCase()}`));
    };
    draw();
    return box;
}

/**
 * One field bound to data[field.key].
 */
export function fieldControl(field, data, path, onChange, ctx = {}) {
    const id = nextId();
    const set = (value) => {
        data[field.key] = value;
        onChange(field.key, value);
    };
    const value = data[field.key];
    let control;
    if (INPUT_TYPES[field.type]) {
        control = h('input', {
            id, type: INPUT_TYPES[field.type], placeholder: field.placeholder || '',
            maxlength: field.maxLength || null, min: field.min ?? null, max: field.max ?? null, step: field.step ?? (field.type === 'number' ? 'any' : null)
        });
        control.value = value ?? '';
        control.addEventListener('input', () => {
            if (field.type === 'number') set(control.value === '' ? '' : Number(control.value));
            else set(control.value);
        });
    } else if (field.type === 'textarea') {
        control = h('textarea', { id, rows: field.rows || 4, placeholder: field.placeholder || '', maxlength: field.maxLength || null });
        control.value = value ?? '';
        control.addEventListener('input', () => set(control.value));
    } else if (field.type === 'markdown') {
        control = markdownControl(field, value, set, id);
    } else if (field.type === 'select') {
        control = h('select', { id }, h('option', { value: '' }, '(none)'), field.options.map((o) => h('option', { value: o, selected: o === value }, o)));
        control.addEventListener('change', () => set(control.value));
    } else if (field.type === 'checkbox') {
        const box = h('input', { id, type: 'checkbox', checked: !!value });
        box.addEventListener('change', () => set(box.checked));
        control = h('label', { class: 'check', for: id }, box, field.label);
    } else if (field.type === 'image') {
        control = imageControl(field, value, set, id);
    } else if (field.type === 'list') {
        control = listControl(field, value, set);
    } else if (field.type === 'repeater') {
        control = repeaterControl(field, value, set, path, ctx);
    } else {
        control = h('p', { class: 'muted' }, `Unsupported field type: ${field.type}`);
    }
    return wrapper(field, path, control, id);
}

export function buildForm(schema, data, onChange, ctx = {}) {
    const form = h('div', { class: 'content-fields' }, (schema.fields || []).map((f) => fieldControl(f, data, f.key, onChange, ctx)));
    return {
        element: form,
        /** Show server validation errors next to their fields. */
        showErrors(errors = []) {
            for (const el of form.querySelectorAll('.field.has-error')) {
                el.classList.remove('has-error');
                el.querySelector(':scope > .error').hidden = true;
            }
            let first = null;
            for (const err of errors) {
                const el = form.querySelector(`.field[data-path="${CSS.escape(err.path || '')}"]`)
                    || form.querySelector(`.field[data-path="${CSS.escape((err.path || '').replace(/\[\d+\].*$/, ''))}"]`);
                if (!el) continue;
                el.classList.add('has-error');
                const msg = el.querySelector(':scope > .error');
                msg.hidden = false;
                msg.textContent = err.message;
                if (!first) first = el;
                el.closest('details')?.setAttribute('open', '');
            }
            first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };
}
