/**
 * User administration (admins).
 */

import { del, get, patch, post } from '../api.js';
import { confirmDialog, field, h, mount, openDialog, showError, timeAgo, toast } from '../dom.js';
import { state } from '../state.js';

const ROLE_HELP = {
    contributor: 'Creates pages and edits their own; submits them for review.',
    editor: 'Edits and publishes any page; manages blocks, media and feedback.',
    admin: 'Everything, plus users, site settings and system tools.'
};

function roleSelect(value) {
    return h('select', { required: true }, Object.keys(ROLE_HELP).map((r) => h('option', { value: r, selected: r === value }, r)));
}

function showPassword(username, password) {
    return openDialog({
        title: 'Temporary password',
        body: h('div', null,
            h('p', null, `Give this password to ${username} privately. They must change it when they first sign in. It will not be shown again.`),
            h('p', { class: 'codes' }, password),
            h('button', { type: 'button', class: 'small', onClick: async () => {
                try { await navigator.clipboard.writeText(password); toast('Copied'); } catch { /* clipboard blocked */ }
            } }, 'Copy')),
        actions: [{ label: 'Done', value: true, primary: true }]
    });
}

export async function render(main) {
    const { users } = await get('/api/users');

    async function addUser() {
        const username = h('input', { type: 'text', required: true, autocapitalize: 'none', pattern: '[a-z0-9][a-z0-9_\\-]{2,31}' });
        const displayName = h('input', { type: 'text', maxlength: 80 });
        const role = roleSelect('contributor');
        const help = h('p', { class: 'help' }, ROLE_HELP.contributor);
        role.addEventListener('change', () => { help.textContent = ROLE_HELP[role.value]; });
        const created = await openDialog({
            title: 'Add user',
            body: h('div', null,
                field('Username', username, { help: '3-32 lowercase letters, numbers, hyphens or underscores.' }),
                field('Display name', displayName),
                h('div', { class: 'field' }, h('label', null, 'Role'), role, help)),
            actions: [{ label: 'Cancel', value: null }, { label: 'Add user', value: 'add', primary: true, submit: true }],
            onSubmit: () => post('/api/users', { username: username.value.trim().toLowerCase(), displayName: displayName.value, role: role.value })
        });
        if (created) {
            await showPassword(created.user.username, created.temporaryPassword);
            render(main);
        }
    }

    async function edit(user) {
        const displayName = h('input', { type: 'text', value: user.displayName, maxlength: 80 });
        const role = roleSelect(user.role);
        const self = user.username === state.user.username;
        role.disabled = self;
        const changed = await openDialog({
            title: `Edit ${user.username}`,
            body: h('div', null, field('Display name', displayName), h('div', { class: 'field' }, h('label', null, 'Role'), role,
                self ? h('p', { class: 'help' }, 'You cannot change your own role.') : null)),
            actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true, submit: true }],
            onSubmit: () => patch(`/api/users/${user.username}`, self ? { displayName: displayName.value } : { displayName: displayName.value, role: role.value })
        });
        if (changed) render(main);
    }

    async function act(user, action) {
        try {
            if (action === 'reset') {
                if (!(await confirmDialog('Reset password', `Create a new temporary password for ${user.username}? They will be signed out everywhere.`, { confirmLabel: 'Reset' }))) return;
                const { temporaryPassword } = await post(`/api/users/${user.username}/reset-password`);
                await showPassword(user.username, temporaryPassword);
            } else if (action === 'toggle') {
                await patch(`/api/users/${user.username}`, { disabled: !user.disabled });
                toast(user.disabled ? 'User enabled' : 'User disabled and signed out');
            } else if (action === 'delete') {
                if (!(await confirmDialog('Delete user', `Delete ${user.username}? Their pages stay. This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
                await del(`/api/users/${user.username}`);
            }
            render(main);
        } catch (err) { showError(err); }
    }

    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'Users'), h('button', { type: 'button', class: 'primary', onClick: addUser }, 'Add user')),
        h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, ['User', 'Role', 'Last sign-in', ''].map((t) => h('th', null, t)))),
            h('tbody', null, users.map((u) => {
                const self = u.username === state.user.username;
                return h('tr', null,
                    h('td', null, h('strong', null, u.displayName || u.username), h('div', { class: 'muted small' }, u.username, self ? ' (you)' : '')),
                    h('td', null, h('span', { class: 'badge' }, u.role), u.disabled ? [' ', h('span', { class: 'badge danger' }, 'Disabled')] : null,
                        u.mustChangePassword ? [' ', h('span', { class: 'badge warn' }, 'Temporary password')] : null),
                    h('td', { class: 'small' }, u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'),
                    h('td', { class: 'actions' },
                        h('button', { type: 'button', class: 'small', onClick: () => edit(u) }, 'Edit'),
                        h('button', { type: 'button', class: 'small', onClick: () => act(u, 'reset') }, 'Reset password'),
                        self ? null : h('button', { type: 'button', class: 'small', onClick: () => act(u, 'toggle') }, u.disabled ? 'Enable' : 'Disable'),
                        self ? null : h('button', { type: 'button', class: 'small danger', onClick: () => act(u, 'delete') }, 'Delete')));
            })))),
        h('div', { class: 'panel' }, h('h2', null, 'Roles'), h('dl', { class: 'kv' }, Object.entries(ROLE_HELP).map(([r, d]) => [h('dt', null, r), h('dd', null, d)]))));
}
