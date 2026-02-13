/**
 * Shared pageId normalization and validation utilities.
 */

function toStringValue(input) {
    return typeof input === 'string' ? input : String(input || '');
}

export function sanitizePageId(input) {
    return toStringValue(input)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

export function isValidPageId(value, { min = 3, max = 50 } = {}) {
    return /^[a-z0-9_-]+$/.test(value) && value.length >= min && value.length <= max;
}

export function getStrictPageId(input, { min = 3, max = 50, trim = true } = {}) {
    const raw = toStringValue(input);
    const normalized = trim ? raw.trim().toLowerCase() : raw.toLowerCase();
    if (!isValidPageId(normalized, { min, max })) {
        return null;
    }
    return normalized;
}

export function getUnchangedSanitizedPageId(input, { min = 1, max = 100 } = {}) {
    const rawLower = toStringValue(input).toLowerCase();
    const sanitized = sanitizePageId(input);
    if (!isValidPageId(sanitized, { min, max })) {
        return null;
    }
    if (sanitized !== rawLower) {
        return null;
    }
    return sanitized;
}
