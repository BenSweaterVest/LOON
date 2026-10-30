/**
 * Shared admin state: the signed-in user and cached site settings.
 */

import { get } from './api.js';

const ROLES = ['contributor', 'editor', 'admin'];

export const state = {
    user: null,
    session: null,
    security: null,
    settings: null
};

export function hasRole(role) {
    return !!state.user && ROLES.indexOf(state.user.role) >= ROLES.indexOf(role);
}

export async function refreshMe() {
    const me = await get('/api/auth/me', { quiet: true });
    state.user = me.user;
    state.session = me.session || null;
    state.security = me.security || null;
    return me.user;
}

export async function loadSettings(force = false) {
    if (!state.settings || force) state.settings = (await get('/api/settings')).settings;
    return state.settings;
}
