/**
 * Sign-in (password, passkey, recovery code) and forced password change.
 */

import { post, errorLines } from '../api.js';
import { field, h, mount, showError, toast } from '../dom.js';
import { state } from '../state.js';
import { passkeyErrorMessage, passkeysSupported, usePasskey } from '../lib/webauthn.js';

function card(...children) {
    return h('div', { class: 'auth' }, h('div', { class: 'card' }, ...children));
}

function errorBox() {
    return h('div', { class: 'notice danger', role: 'alert', hidden: true });
}

function setError(box, message) {
    box.hidden = !message;
    box.textContent = message || '';
}

export function renderLogin(app, done) {
    const error = errorBox();
    const username = h('input', { type: 'text', name: 'username', autocomplete: 'username webauthn', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');

    const form = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            setError(error, '');
            submit.disabled = true;
            try {
                await post('/api/auth/login', { username: username.value, password: password.value });
                done();
            } catch (err) {
                setError(error, err.message);
                password.select();
            } finally {
                submit.disabled = false;
            }
        }
    }, error, field('Username', username), field('Password', password), submit);

    const passkeyButton = h('button', {
        type: 'button',
        onClick: async () => {
            setError(error, '');
            try {
                const { challengeId, options } = await post('/api/passkeys/login/options', { username: username.value });
                const response = await usePasskey(options);
                await post('/api/passkeys/login/verify', { challengeId, response });
                done();
            } catch (err) {
                setError(error, err.status ? err.message : passkeyErrorMessage(err));
            }
        }
    }, 'Sign in with a passkey');

    const recoveryLink = h('button', { type: 'button', class: 'link small', onClick: () => renderRecovery(app, done) }, 'Use a recovery code');

    mount(app, card(
        h('h1', null, 'Sign in'),
        h('p', { class: 'sub' }, 'LOON content editor'),
        form,
        passkeysSupported() ? [h('div', { class: 'divider' }, 'or'), passkeyButton] : null,
        h('div', { class: 'alt' }, recoveryLink, h('a', { class: 'small', href: '/' }, 'Back to the site'))
    ));
    username.focus();
}

function renderRecovery(app, done) {
    const error = errorBox();
    const username = h('input', { type: 'text', autocomplete: 'username', required: true, autocapitalize: 'none' });
    const code = h('input', { type: 'text', autocomplete: 'one-time-code', required: true, placeholder: 'XXXXX-XXXXX', autocapitalize: 'characters' });
    const form = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            setError(error, '');
            try {
                await post('/api/auth/recovery', { username: username.value, code: code.value });
                toast('Recovery code accepted. Choose a new password.');
                done();
            } catch (err) {
                setError(error, err.message);
            }
        }
    }, error, field('Username', username), field('Recovery code', code, { help: 'Each code works once. You will be asked to set a new password.' }), h('button', { type: 'submit', class: 'primary' }, 'Continue'));
    mount(app, card(
        h('h1', null, 'Use a recovery code'),
        h('p', { class: 'sub' }, 'For when you lost your passkey or password.'),
        form,
        h('div', { class: 'alt' }, h('button', { type: 'button', class: 'link small', onClick: () => renderLogin(app, done) }, 'Back to sign in'))
    ));
    username.focus();
}

export function renderPasswordChange(app, done) {
    const error = errorBox();
    const recovery = state.session?.method === 'recovery';
    const current = h('input', { type: 'password', autocomplete: 'current-password', required: !recovery });
    const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const form = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            setError(error, '');
            if (next.value !== confirm.value) return setError(error, 'The new passwords do not match.');
            try {
                await post('/api/auth/password', { currentPassword: current.value, newPassword: next.value });
                toast('Password changed.');
                done();
            } catch (err) {
                setError(error, [err.message, ...errorLines(err)].join(' '));
            }
            return undefined;
        }
    },
    error,
    recovery ? null : field('Current or temporary password', current),
    field('New password', next, { help: 'At least 10 characters. A short sentence is easy to remember and hard to guess.' }),
    field('Confirm new password', confirm),
    h('button', { type: 'submit', class: 'primary' }, 'Set password'));

    mount(app, card(
        h('h1', null, 'Set a new password'),
        h('p', { class: 'sub' }, recovery ? 'You signed in with a recovery code.' : 'Your password must be changed before you continue.'),
        form,
        h('div', { class: 'alt' }, h('button', {
            type: 'button', class: 'link small',
            onClick: async () => {
                try { await post('/api/auth/logout'); } catch (err) { showError(err); }
                done();
            }
        }, 'Sign out'))
    ));
    (recovery ? next : current).focus();
}
