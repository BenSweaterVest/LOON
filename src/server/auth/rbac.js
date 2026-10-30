/**
 * Roles, ordered from least to most privileged.
 *   contributor: create pages, edit own pages, submit for review
 *   editor:      edit and publish any page, manage blocks and media
 *   admin:       everything, plus users, sessions, settings and audit
 */

export const ROLES = ['contributor', 'editor', 'admin'];

export function isRole(value) {
    return ROLES.includes(value);
}

export function hasRole(user, minimum) {
    if (!user || !isRole(user.role)) return false;
    return ROLES.indexOf(user.role) >= ROLES.indexOf(minimum);
}

export function canEditPage(user, page) {
    if (hasRole(user, 'editor')) return true;
    return !!user && !!page && page.created_by === user.username;
}

export function canPublish(user) {
    return hasRole(user, 'editor');
}
