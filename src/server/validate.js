/**
 * Input validation helpers. Each returns the cleaned value or throws 400.
 */

import { badRequest } from './http.js';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function requireString(value, name, { min = 1, max = 1000, trim = true } = {}) {
    if (typeof value !== 'string') throw badRequest(`${name} is required`);
    const cleaned = trim ? value.trim() : value;
    if (cleaned.length < min) throw badRequest(min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`);
    if (cleaned.length > max) throw badRequest(`${name} must be at most ${max} characters`);
    return cleaned;
}

export function optionalString(value, name, { max = 1000, trim = true } = {}) {
    if (value === undefined || value === null || value === '') return '';
    return requireString(value, name, { min: 0, max, trim });
}

export function requireUsername(value) {
    const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!USERNAME_PATTERN.test(username)) {
        throw badRequest('Username must be 3-32 characters: lowercase letters, numbers, hyphens or underscores, starting with a letter or number');
    }
    return username;
}

export function requireOneOf(value, name, allowed) {
    if (!allowed.includes(value)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}`);
    return value;
}

export function optionalInt(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be an integer between ${min} and ${max}`);
    return n;
}

export function clampLimit(value, fallback = 50, max = 200) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(max, n);
}
