/**
 * Page schemas: field types, schema validation and content validation.
 * Shared by the API, the admin editor and the static site build, so it must
 * stay dependency-free and runtime-neutral.
 *
 * Schema: { fields: [ { key, label, type, required?, placeholder?, description?,
 *                       options?, min?, max?, maxLength?, rows?, fields? } ] }
 */

export const FIELD_TYPES = {
    text: { label: 'Short text', maxLength: 500 },
    textarea: { label: 'Long text', maxLength: 10000 },
    markdown: { label: 'Formatted text (Markdown)', maxLength: 100000 },
    number: { label: 'Number' },
    url: { label: 'Link', maxLength: 2000 },
    email: { label: 'Email', maxLength: 320 },
    tel: { label: 'Phone', maxLength: 40 },
    date: { label: 'Date' },
    time: { label: 'Time' },
    datetime: { label: 'Date and time' },
    select: { label: 'Choice' },
    checkbox: { label: 'Yes / no' },
    image: { label: 'Image' },
    list: { label: 'List of short items', maxItems: 200 },
    repeater: { label: 'Repeating group', maxItems: 200 }
};

export const MAX_FIELDS = 100;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepts http(s) URLs, mailto/tel links, site-relative paths and #anchors.
 * Rejects javascript:, data: and anything else that could execute.
 */
export function isSafeUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    const trimmed = value.trim();
    if (/[\u0000-\u001f\s]/.test(trimmed)) return false;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
    if (trimmed.startsWith('#')) return true;
    return /^(https?:\/\/[^/]|mailto:|tel:)/i.test(trimmed);
}

function validDate(value) {
    if (!DATE_PATTERN.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function cleanText(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * Normalize and validate a schema. Returns { schema, errors }.
 */
export function validateSchema(input, { nested = false } = {}) {
    const errors = [];
    const fieldsIn = Array.isArray(input?.fields) ? input.fields : null;
    if (!fieldsIn) return { schema: { fields: [] }, errors: ['Schema must have a fields array'] };
    if (fieldsIn.length > MAX_FIELDS) errors.push(`A schema can have at most ${MAX_FIELDS} fields`);

    const seen = new Set();
    const fields = [];
    fieldsIn.slice(0, MAX_FIELDS).forEach((raw, index) => {
        const where = `Field ${index + 1}`;
        if (!raw || typeof raw !== 'object') {
            errors.push(`${where} must be an object`);
            return;
        }
        const key = typeof raw.key === 'string' ? raw.key.trim() : '';
        if (!KEY_PATTERN.test(key)) {
            errors.push(`${where}: key must start with a letter and use only lowercase letters, numbers and underscores (max 40)`);
            return;
        }
        if (seen.has(key)) errors.push(`${where}: duplicate key "${key}"`);
        seen.add(key);

        const type = raw.type;
        if (!FIELD_TYPES[type]) {
            errors.push(`${where} (${key}): unknown type "${type}"`);
            return;
        }
        if (nested && type === 'repeater') {
            errors.push(`${where} (${key}): repeaters cannot be nested`);
            return;
        }

        const field = { key, label: cleanText(raw.label).trim().slice(0, 120) || key, type };
        if (raw.required === true) field.required = true;
        for (const prop of ['placeholder', 'description']) {
            if (typeof raw[prop] === 'string' && raw[prop].trim()) field[prop] = raw[prop].trim().slice(0, 300);
        }
        const maxLength = raw.maxLength ?? raw.maxlength;
        if (Number.isInteger(maxLength) && maxLength > 0) {
            field.maxLength = Math.min(maxLength, FIELD_TYPES[type].maxLength ?? maxLength);
        }
        if (type === 'number') {
            if (typeof raw.min === 'number') field.min = raw.min;
            if (typeof raw.max === 'number') field.max = raw.max;
            if (typeof raw.step === 'number' && raw.step > 0) field.step = raw.step;
        }
        if ((type === 'textarea' || type === 'markdown') && Number.isInteger(raw.rows) && raw.rows > 0) {
            field.rows = Math.min(raw.rows, 40);
        }
        if (type === 'select') {
            const options = Array.isArray(raw.options)
                ? [...new Set(raw.options.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim().slice(0, 120)))]
                : [];
            if (!options.length) errors.push(`${where} (${key}): a choice field needs at least one option`);
            field.options = options.slice(0, 100);
        }
        if (type === 'repeater') {
            const inner = validateSchema({ fields: raw.fields }, { nested: true });
            inner.errors.forEach((e) => errors.push(`${where} (${key}): ${e}`));
            if (!inner.schema.fields.length && !inner.errors.length) errors.push(`${where} (${key}): a repeating group needs fields`);
            field.fields = inner.schema.fields;
            if (typeof raw.itemLabel === 'string' && raw.itemLabel.trim()) field.itemLabel = raw.itemLabel.trim().slice(0, 60);
        }
        fields.push(field);
    });
    return { schema: { fields }, errors };
}

function isEmpty(value) {
    return value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && !Array.isArray(value) && value !== null && 'src' in value && !value.src);
}

function validateField(field, value, path, errors) {
    const type = FIELD_TYPES[field.type];
    const fail = (message) => {
        errors.push({ path, message: `${field.label}: ${message}` });
        return undefined;
    };
    if (value === undefined || value === null) return undefined;

    switch (field.type) {
        case 'text':
        case 'textarea':
        case 'markdown':
        case 'tel': {
            if (typeof value !== 'string') return fail('must be text');
            const max = field.maxLength ?? type.maxLength;
            if (value.length > max) return fail(`must be at most ${max} characters`);
            return value;
        }
        case 'email': {
            if (typeof value !== 'string') return fail('must be text');
            const v = value.trim();
            if (v && !EMAIL_PATTERN.test(v)) return fail('must be a valid email address');
            if (v.length > type.maxLength) return fail('is too long');
            return v;
        }
        case 'url': {
            if (typeof value !== 'string') return fail('must be text');
            const v = value.trim();
            if (v && !isSafeUrl(v)) return fail('must be a web address (https://...), a site path (/page), mailto: or tel:');
            if (v.length > type.maxLength) return fail('is too long');
            return v;
        }
        case 'number': {
            if (value === '') return '';
            const n = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(n)) return fail('must be a number');
            if (field.min !== undefined && n < field.min) return fail(`must be at least ${field.min}`);
            if (field.max !== undefined && n > field.max) return fail(`must be at most ${field.max}`);
            return n;
        }
        case 'checkbox':
            if (typeof value !== 'boolean') return fail('must be true or false');
            return value;
        case 'select':
            if (value === '') return '';
            if (!field.options.includes(value)) return fail('is not one of the allowed choices');
            return value;
        case 'date':
            if (value === '') return '';
            if (typeof value !== 'string' || !validDate(value)) return fail('must be a date (YYYY-MM-DD)');
            return value;
        case 'time':
            if (value === '') return '';
            if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return fail('must be a time (HH:MM)');
            return value;
        case 'datetime':
            if (value === '') return '';
            if (typeof value !== 'string' || !DATETIME_PATTERN.test(value) || !validDate(value.slice(0, 10))) {
                return fail('must be a date and time (YYYY-MM-DDTHH:MM)');
            }
            return value;
        case 'image': {
            const img = typeof value === 'string' ? { src: value, alt: '' } : value;
            if (!img || typeof img !== 'object' || Array.isArray(img)) return fail('must be an image');
            const src = typeof img.src === 'string' ? img.src.trim() : '';
            const alt = typeof img.alt === 'string' ? img.alt.slice(0, 300) : '';
            if (src && !isSafeUrl(src)) return fail('image source must be a web address or site path');
            return { src, alt };
        }
        case 'list': {
            if (!Array.isArray(value)) return fail('must be a list');
            if (value.length > type.maxItems) return fail(`can have at most ${type.maxItems} items`);
            const items = [];
            value.forEach((item, i) => {
                if (typeof item !== 'string') {
                    errors.push({ path: `${path}[${i}]`, message: `${field.label}: item ${i + 1} must be text` });
                } else if (item.length > 500) {
                    errors.push({ path: `${path}[${i}]`, message: `${field.label}: item ${i + 1} is too long` });
                } else {
                    items.push(item);
                }
            });
            return items;
        }
        case 'repeater': {
            if (!Array.isArray(value)) return fail('must be a list of entries');
            if (value.length > type.maxItems) return fail(`can have at most ${type.maxItems} entries`);
            return value.map((item, i) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    errors.push({ path: `${path}[${i}]`, message: `${field.label}: entry ${i + 1} is invalid` });
                    return {};
                }
                return validateObject(field.fields, item, `${path}[${i}]`, errors, { requireAll: false });
            });
        }
        default:
            return fail('has an unsupported type');
    }
}

function validateObject(fields, data, prefix, errors, { requireAll }) {
    const out = {};
    for (const field of fields) {
        const path = prefix ? `${prefix}.${field.key}` : field.key;
        const value = validateField(field, data[field.key], path, errors);
        if (value !== undefined) out[field.key] = value;
        if (requireAll && field.required && isEmpty(out[field.key])) {
            errors.push({ path, message: `${field.label} is required`, required: true });
        }
        if (requireAll && field.type === 'repeater' && Array.isArray(out[field.key])) {
            out[field.key].forEach((entry, i) => {
                for (const sub of field.fields) {
                    if (sub.required && isEmpty(entry[sub.key])) {
                        errors.push({ path: `${path}[${i}].${sub.key}`, message: `${field.label} ${i + 1}: ${sub.label} is required`, required: true });
                    }
                }
            });
        }
    }
    return out;
}

/**
 * Validate content against a schema. Unknown keys are dropped.
 * With requireAll (used at publish time), required fields must be filled.
 * Returns { data, errors: [{ path, message, required? }] }.
 */
export function validateContent(schema, data, { requireAll = false } = {}) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { data: {}, errors: [{ path: '', message: 'Content must be an object' }] };
    }
    const cleaned = validateObject(schema.fields || [], data, '', errors, { requireAll });
    return { data: cleaned, errors };
}

/**
 * An empty value for each field, used when creating pages.
 */
export function emptyContent(schema) {
    const out = {};
    for (const field of schema.fields || []) {
        if (field.type === 'checkbox') out[field.key] = false;
        else if (field.type === 'list' || field.type === 'repeater') out[field.key] = [];
        else if (field.type === 'image') out[field.key] = { src: '', alt: '' };
        else out[field.key] = '';
    }
    return out;
}
