/**
 * DOM helpers. Everything is built with createElement and textContent, so
 * user content is never parsed as HTML.
 */

export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key === 'style') Object.assign(el.style, value);
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled' || key === 'indeterminate') el[key] = value;
            else el.setAttribute(key, value === true ? '' : String(value));
        }
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === undefined || child === null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

export function clear(el) {
    while (el.firstChild) el.firstChild.remove();
    return el;
}

export function mount(el, ...children) {
    clear(el);
    return append(el, children);
}

export function toast(message, { error = false, timeout = 4000 } = {}) {
    const region = document.querySelector('.toasts');
    const node = h('div', { class: `toast${error ? ' error' : ''}` }, message);
    region.append(node);
    setTimeout(() => node.remove(), error ? timeout * 2 : timeout);
}

export function showError(err, fallback = 'Something went wrong') {
    const lines = Array.isArray(err?.details) ? err.details.map((d) => (typeof d === 'string' ? d : d.message)) : [];
    toast([err?.message || fallback, ...lines.slice(0, 3)].join(' · '), { error: true });
}

/**
 * Open a modal dialog. `body` is a Node or a function (form, close) => Node;
 * calling close(value) from inside the body resolves the dialog with value.
 * Actions: [{ label, value, primary, danger }]. Resolves with the chosen value,
 * or null when dismissed. An action with `submit: true` requires a valid form,
 * and `onSubmit` may return false (or throw) to keep the dialog open.
 */
export function openDialog({ title, body, actions = [{ label: 'Close', value: null }], wide = false, onSubmit = null }) {
    return new Promise((resolve) => {
        const form = h('form', { method: 'dialog', novalidate: true });
        const dialog = h('dialog', { class: wide ? 'wide' : '' }, form);
        const close = (value) => {
            if (!dialog.isConnected) return;
            dialog.close();
            dialog.remove();
            resolve(value);
        };
        const content = typeof body === 'function' ? body(form, close) : body;
        const buttons = actions.map((action) => h('button', {
            type: action.submit ? 'submit' : 'button',
            class: [action.primary ? 'primary' : '', action.danger ? 'danger solid' : ''].join(' ').trim(),
            onClick: async (event) => {
                if (!action.submit) return close(action.value);
                event.preventDefault();
                if (!form.reportValidity()) return undefined;
                if (onSubmit) {
                    event.target.disabled = true;
                    try {
                        const result = await onSubmit(action.value, form);
                        if (result === false) return undefined;
                        return close(result === undefined ? action.value : result);
                    } catch (err) {
                        showError(err);
                        return undefined;
                    } finally {
                        event.target.disabled = false;
                    }
                }
                return close(action.value);
            }
        }, action.label));
        append(form, [
            h('div', { class: 'dialog-head' }, h('h2', null, title)),
            h('div', { class: 'dialog-body' }, content),
            h('div', { class: 'dialog-actions' }, buttons)
        ]);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const primary = buttons.find((b) => b.type === 'submit');
            if (primary) primary.click();
        });
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            close(null);
        });
        document.body.append(dialog);
        dialog.showModal();
        const focusTarget = dialog.querySelector('input:not([type=hidden]), textarea, select') || buttons[buttons.length - 1];
        if (focusTarget) focusTarget.focus();
    });
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
    return openDialog({
        title,
        body: h('p', null, message),
        actions: [
            { label: 'Cancel', value: false },
            { label: confirmLabel, value: true, primary: !danger, danger }
        ]
    }).then((value) => value === true);
}

export function field(labelText, control, { help, required, id } = {}) {
    const controlId = id || control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
    control.id = controlId;
    return h('div', { class: 'field' },
        h('label', { for: controlId }, labelText, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null),
        control,
        help ? h('p', { class: 'help' }, help) : null);
}

const rtf = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function timeAgo(ms) {
    if (!ms) return '';
    const diff = (ms - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (!rtf || abs > 7 * 86400) return formatDate(ms);
    if (abs < 60) return rtf.format(Math.round(diff), 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDate(ms, withTime = true) {
    if (!ms) return '';
    return new Date(ms).toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

export function debounce(fn, ms) {
    let timer;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
    wrapped.flush = (...args) => {
        clearTimeout(timer);
        fn(...args);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

export function downloadFile(filename, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function storage() {
    try {
        const test = '__loon';
        localStorage.setItem(test, '1');
        localStorage.removeItem(test);
        return localStorage;
    } catch {
        return null;
    }
}
