/**
 * My account: password, passkeys, recovery codes and sessions.
 */

import { del, get, patch, post, errorLines } from '../api.js';
import { confirmDialog, downloadFile, field, formatDate, h, mount, openDialog, showError, timeAgo, toast } from '../dom.js';
import { refreshMe, state } from '../state.js';
import { createPasskey, passkeyErrorMessage, passkeysSupported } from '../lib/webauthn.js';

function showCodes(codes) {
    return openDialog({
        title: 'Recovery codes',
        body: h('div', null,
            h('p', null, 'Each code signs you in once if you lose your passkey or forget your password. Save them somewhere safe now; they will not be shown again.'),
            h('div', { class: 'codes' }, codes.map((c) => h('span', null, c))),
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'small', onClick: () => downloadFile('loon-recovery-codes.txt', `LOON recovery codes for ${state.user.username}\n\n${codes.join('\n')}\n`, 'text/plain') }, 'Download'),
                h('button', { type: 'button', class: 'small', onClick: async () => {
                    try { await navigator.clipboard.writeText(codes.join('\n')); toast('Copied'); } catch { /* blocked */ }
                } }, 'Copy'))),
        actions: [{ label: 'I saved them', value: true, primary: true }]
    });
}

export async function render(main) {
    await refreshMe();
    const [{ passkeys }, { sessions }] = await Promise.all([get('/api/passkeys'), get('/api/sessions')]);

    const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const passwordForm = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            if (next.value !== confirm.value) return showError({ message: 'The new passwords do not match' });
            try {
                await post('/api/auth/password', { currentPassword: current.value, newPassword: next.value });
                passwordForm.reset();
                toast('Password changed. Other sessions were signed out.');
                render(main);
            } catch (err) {
                showError({ message: [err.message, ...errorLines(err)].join(' ') });
            }
            return undefined;
        }
    }, field('Current password', current), field('New password', next, { help: 'At least 10 characters.' }), field('Confirm new password', confirm),
    h('button', { type: 'submit', class: 'primary' }, 'Change password'));

    async function addPasskey() {
        try {
            const { challengeId, options } = await post('/api/passkeys/register/options');
            const response = await createPasskey(options);
            const name = navigator.userAgentData?.platform || (/(iPhone|iPad|Android|Mac|Windows|Linux)/.exec(navigator.userAgent)?.[1]) || 'Passkey';
            const res = await post('/api/passkeys/register/verify', { challengeId, response, name });
            toast('Passkey added');
            if (res.recoveryCodes) await showCodes(res.recoveryCodes);
            render(main);
        } catch (err) {
            showError(err.status ? err : { message: passkeyErrorMessage(err) });
        }
    }

    async function rename(pk) {
        const input = h('input', { type: 'text', value: pk.name, maxlength: 60, required: true });
        const ok = await openDialog({
            title: 'Rename passkey', body: field('Name', input),
            actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true, submit: true }],
            onSubmit: () => patch(`/api/passkeys/${encodeURIComponent(pk.id)}`, { name: input.value })
        });
        if (ok) render(main);
    }

    async function removePasskey(pk) {
        if (!(await confirmDialog('Remove passkey', `Remove “${pk.name}”? You can still sign in with your password.`, { confirmLabel: 'Remove', danger: true }))) return;
        try { await del(`/api/passkeys/${encodeURIComponent(pk.id)}`); render(main); } catch (err) { showError(err); }
    }

    async function regenerate() {
        if (!(await confirmDialog('New recovery codes', 'Create 10 new codes? Your old codes stop working.', { confirmLabel: 'Create codes' }))) return;
        try { await showCodes((await post('/api/passkeys/recovery-codes')).recoveryCodes); render(main); } catch (err) { showError(err); }
    }

    const sec = state.security || { passkeys: 0, recoveryCodesRemaining: 0 };
    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'My account')),
        h('div', { class: 'grid-2' },
            h('div', { class: 'panel' },
                h('h2', null, 'Profile'),
                h('dl', { class: 'kv' },
                    h('dt', null, 'Username'), h('dd', null, state.user.username),
                    h('dt', null, 'Name'), h('dd', null, state.user.displayName),
                    h('dt', null, 'Role'), h('dd', null, state.user.role)),
                h('h2', null, 'Password'),
                passwordForm),
            h('div', { class: 'panel' },
                h('h2', null, 'Passkeys'),
                h('p', { class: 'muted small' }, 'Sign in with your fingerprint, face or device PIN instead of a password. Passkeys cannot be phished.'),
                passkeys.length ? h('ul', { class: 'revisions' }, passkeys.map((pk) => h('li', null,
                    h('div', null, h('strong', null, pk.name), h('div', { class: 'muted small' }, `Added ${formatDate(pk.createdAt, false)} · ${pk.lastUsedAt ? `last used ${timeAgo(pk.lastUsedAt)}` : 'never used'}${pk.backedUp ? ' · synced' : ''}`)),
                    h('div', { class: 'row' },
                        h('button', { type: 'button', class: 'small', onClick: () => rename(pk) }, 'Rename'),
                        h('button', { type: 'button', class: 'small danger', onClick: () => removePasskey(pk) }, 'Remove'))))) : null,
                passkeysSupported()
                    ? h('button', { type: 'button', class: 'primary', onClick: addPasskey }, 'Add a passkey')
                    : h('p', { class: 'notice warn' }, 'This browser does not support passkeys.'),
                h('h2', null, 'Recovery codes'),
                h('p', { class: 'small' }, `${sec.recoveryCodesRemaining} unused code(s).`),
                h('button', { type: 'button', class: 'small', onClick: regenerate }, sec.recoveryCodesRemaining ? 'Replace recovery codes' : 'Create recovery codes'))),
        h('div', { class: 'panel' },
            h('h2', null, 'Where you are signed in'),
            h('ul', { class: 'revisions' }, sessions.map((s) => h('li', null,
                h('div', null, h('strong', null, s.current ? 'This browser' : (s.userAgent || 'Unknown device').slice(0, 70)),
                    h('div', { class: 'muted small' }, `${s.method} · signed in ${formatDate(s.createdAt)} · active ${timeAgo(s.lastSeenAt)} · ${s.ip || ''}`)),
                s.current ? null : h('button', { type: 'button', class: 'small danger', onClick: async () => {
                    try { await del(`/api/sessions/${s.id}`); render(main); } catch (err) { showError(err); }
                } }, 'Sign out')))),
            sessions.length > 1 ? h('button', { type: 'button', class: 'small', onClick: async () => {
                try { await post('/api/sessions/revoke-others'); toast('Signed out everywhere else'); render(main); } catch (err) { showError(err); }
            } }, 'Sign out everywhere else') : null));
}
