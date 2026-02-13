import { describe, it, expect } from 'vitest';
import {
    sanitizePageId,
    isValidPageId,
    getStrictPageId,
    getUnchangedSanitizedPageId
} from '../functions/lib/page-id.js';

describe('Page ID Utilities', () => {
    it('sanitizePageId should normalize case, trim, and remove invalid chars', () => {
        expect(sanitizePageId('  Demo@Page  ')).toBe('demopage');
        expect(sanitizePageId('my_page-1')).toBe('my_page-1');
    });

    it('isValidPageId should enforce charset and length', () => {
        expect(isValidPageId('demo')).toBe(true);
        expect(isValidPageId('de')).toBe(false);
        expect(isValidPageId('bad id')).toBe(false);
        expect(isValidPageId('ok', { min: 1, max: 2 })).toBe(true);
    });

    it('getStrictPageId should validate trimmed values when trim=true', () => {
        expect(getStrictPageId('  demo-page  ', { min: 3, max: 50, trim: true })).toBe('demo-page');
        expect(getStrictPageId('bad id', { min: 3, max: 50, trim: true })).toBeNull();
    });

    it('getUnchangedSanitizedPageId should reject transformed inputs', () => {
        expect(getUnchangedSanitizedPageId('demo-page')).toBe('demo-page');
        expect(getUnchangedSanitizedPageId('Demo-Page')).toBe('demo-page');
        expect(getUnchangedSanitizedPageId('demo page')).toBeNull();
        expect(getUnchangedSanitizedPageId(' demo-page ')).toBeNull();
    });
});
