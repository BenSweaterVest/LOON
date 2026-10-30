/**
 * Site-wide settings: defaults and validation. Shared by the API and the build.
 */

import { isSafeUrl } from './schema.js';
import { isValidPageId } from './page-id.js';

export const DEFAULT_SETTINGS = {
    siteName: 'My LOON Site',
    tagline: '',
    homePage: '',
    language: 'en',
    navigation: [],
    footer: '',
    accentColor: '#2563eb',
    feedback: true
};

/**
 * Returns { settings, errors }. Navigation items are { label, href } where
 * href is a page ID (rendered as /<id>/) or a safe URL.
 */
export function validateSettings(input) {
    const errors = [];
    const s = { ...DEFAULT_SETTINGS };
    const str = (key, max) => {
        if (input?.[key] === undefined) return;
        if (typeof input[key] !== 'string') errors.push(`${key} must be text`);
        else if (input[key].length > max) errors.push(`${key} must be at most ${max} characters`);
        else s[key] = input[key].trim();
    };
    str('siteName', 80);
    str('tagline', 200);
    str('footer', 2000);
    if (!s.siteName) errors.push('Site name is required');

    if (input?.homePage !== undefined && input.homePage !== '') {
        if (!isValidPageId(input.homePage)) errors.push('Home page must be a page ID');
        else s.homePage = input.homePage;
    }
    if (input?.language !== undefined) {
        if (typeof input.language !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(input.language)) errors.push('Language must be a code like en or en-US');
        else s.language = input.language;
    }
    if (input?.accentColor !== undefined) {
        if (typeof input.accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) errors.push('Accent color must look like #2563eb');
        else s.accentColor = input.accentColor.toLowerCase();
    }
    if (input?.feedback !== undefined) {
        if (typeof input.feedback !== 'boolean') errors.push('feedback must be true or false');
        else s.feedback = input.feedback;
    }
    if (input?.navigation !== undefined) {
        if (!Array.isArray(input.navigation) || input.navigation.length > 20) {
            errors.push('Navigation must be a list of at most 20 links');
        } else {
            s.navigation = [];
            input.navigation.forEach((item, i) => {
                const label = typeof item?.label === 'string' ? item.label.trim().slice(0, 60) : '';
                const href = typeof item?.href === 'string' ? item.href.trim() : '';
                if (!label || !href) errors.push(`Navigation link ${i + 1} needs a label and a target`);
                else if (!isValidPageId(href) && !isSafeUrl(href)) errors.push(`Navigation link ${i + 1}: target must be a page ID or a web address`);
                else s.navigation.push({ label, href });
            });
        }
    }
    return { settings: s, errors };
}

export function navHref(href) {
    return isValidPageId(href) ? `/${href}/` : href;
}
