/**
 * First-run setup: create the first admin, or restore a backup file into a
 * brand-new instance.
 */

import { post, errorLines } from '../api.js';
import { field, h, mount } from '../dom.js';

const RESTORE_FIRST = ['settings', 'blocks', 'pages', 'revisions', 'media', 'feedback', 'audit'];

export function renderSetup(app, status, done) {
    const error = h('div', { class: 'notice danger', role: 'alert', hidden: true });
    const showError = (message) => {
        error.hidden = !message;
        error.textContent = message || '';
    };
    const token = h('input', { type: 'password', required: true, autocomplete: 'off' });
    const username = h('input', { type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', pattern: '[a-z0-9][a-z0-9_\\-]{2,31}' });
    const displayName = h('input', { type: 'text', autocomplete: 'name' });
    const password = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password' });
    const confirm = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password' });

    const form = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            showError('');
            if (password.value !== confirm.value) return showError('The passwords do not match.');
            try {
                await post('/api/setup', { setupToken: token.value, username: username.value, displayName: displayName.value, password: password.value });
                done();
            } catch (err) {
                showError([err.message, ...errorLines(err)].join(' '));
            }
            return undefined;
        }
    },
    error,
    field('Setup token', token, { required: true, help: 'The SETUP_TOKEN secret from your Cloudflare Pages settings.' }),
    field('Admin username', username, { required: true, help: '3-32 lowercase letters, numbers, hyphens or underscores.' }),
    field('Display name', displayName),
    field('Password', password, { required: true, help: 'At least 10 characters.' }),
    field('Confirm password', confirm, { required: true }),
    h('button', { type: 'submit', class: 'primary' }, 'Create admin account'));

    const progress = h('p', { class: 'muted small', role: 'status' });
    const restoreFile = h('input', {
        type: 'file', accept: 'application/json,.json',
        onChange: async () => {
            showError('');
            const file = restoreFile.files[0];
            if (!file) return;
            if (!token.value) {
                restoreFile.value = '';
                return showError('Enter the setup token first.');
            }
            try {
                await restoreBackup(JSON.parse(await file.text()), token.value, (msg) => { progress.textContent = msg; });
                progress.textContent = 'Restore complete. Sign in with an account from the backup.';
                setTimeout(done, 800);
            } catch (err) {
                showError(`Restore failed: ${err.message}`);
            }
        }
    });

    mount(app, h('div', { class: 'auth' }, h('div', { class: 'card' },
        h('h1', null, 'Welcome to LOON'),
        h('p', { class: 'sub' }, 'Create the first admin account to finish setting up.'),
        status.setupTokenConfigured ? null : h('div', { class: 'notice warn' },
            h('p', null, 'SETUP_TOKEN is not set yet. Add it as a secret in Cloudflare Pages (Settings, Variables and Secrets), redeploy, then reload this page.')),
        form,
        h('details', null,
            h('summary', { class: 'small' }, 'Moving an existing site? Restore a backup instead'),
            h('p', { class: 'small muted' }, 'Choose a backup file downloaded from System. Enter the setup token above first.'),
            restoreFile,
            progress))));
    token.focus();
}

async function restoreBackup(backup, setupToken, report) {
    if (backup?.format !== 'loon-backup' || !backup.tables) throw new Error('This is not a LOON backup file');
    const tables = backup.tables;
    for (const table of RESTORE_FIRST) {
        const rows = tables[table] || [];
        const size = table === 'media' ? 5 : 200;
        for (let i = 0; i < rows.length; i += size) {
            report(`Restoring ${table} (${Math.min(i + size, rows.length)} of ${rows.length})…`);
            await post('/api/setup/restore', { setupToken, table, rows: rows.slice(i, i + size) });
        }
    }
    report('Restoring users…');
    await post('/api/setup/restore', {
        setupToken,
        table: 'users',
        rows: tables.users || [],
        passkeys: tables.passkeys || [],
        recovery_codes: tables.recovery_codes || [],
        watches: tables.watches || []
    });
}
