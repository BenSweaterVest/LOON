/**
 * System (admins): configuration checks, backups, republish, all sessions.
 */

import { del, get, post } from '../api.js';
import { confirmDialog, downloadFile, formatBytes, formatDate, h, mount, showError, timeAgo, toast } from '../dom.js';

const FREE_TIER = [
    ['Pages builds', '500 per month. Each publish is one build.'],
    ['Functions (API) requests', '100,000 per day. Public pages are static and never count.'],
    ['D1 database', '5 GB storage, 5 million rows read and 100,000 rows written per day.'],
    ['GitHub Actions', 'Scheduled publishing uses about 3,000 minutes a month at a 15-minute interval: free and unlimited for public repositories. For a private repository, change the schedule to hourly (about 720 minutes) to stay under the 2,000-minute allowance.']
];

export async function render(main) {
    const diag = await get('/api/diagnostics');
    const checksList = h('ul', { class: 'checks' });
    const drawChecks = (d) => mount(checksList, d.checks.map((c) => h('li', null,
        h('span', { class: `badge ${c.ok ? 'ok' : c.required ? 'danger' : 'warn'}` }, c.ok ? 'OK' : c.required ? 'Fix' : 'Optional'),
        h('span', null, c.label),
        c.id === 'github_access' && d.github?.error ? h('span', { class: 'muted small' }, d.github.error) : null)));
    drawChecks(diag);

    const testButton = h('button', { type: 'button', class: 'small', onClick: async () => {
        testButton.disabled = true;
        try {
            const result = await get('/api/diagnostics?github=1');
            drawChecks(result);
            toast(result.github?.ok ? 'GitHub access works' : 'GitHub access failed; see the checks list', { error: !result.github?.ok });
        } catch (err) { showError(err); } finally { testButton.disabled = false; }
    } }, 'Test GitHub access');

    const backupStatus = h('span', { class: 'small muted', role: 'status' });
    const backupButton = h('button', { type: 'button', class: 'primary', onClick: async () => {
        backupButton.disabled = true;
        try {
            const { schemaVersion, tables } = await get('/api/backup');
            const out = { format: 'loon-backup', schemaVersion, exportedAt: new Date().toISOString(), tables: {} };
            for (const { table, rows } of tables) {
                out.tables[table] = [];
                let offset = 0;
                for (;;) {
                    backupStatus.textContent = `Exporting ${table} (${out.tables[table].length} of ${rows})…`;
                    const chunk = await get(`/api/backup/${table}?offset=${offset}`);
                    out.tables[table].push(...chunk.rows);
                    offset += chunk.rows.length;
                    if (chunk.done) break;
                }
            }
            downloadFile(`loon-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out));
            backupStatus.textContent = 'Backup downloaded. Store it somewhere safe: it contains password hashes.';
        } catch (err) {
            showError(err);
            backupStatus.textContent = '';
        } finally {
            backupButton.disabled = false;
        }
    } }, 'Download backup');

    const republishButton = h('button', { type: 'button', onClick: async () => {
        if (!(await confirmDialog('Republish everything', 'Rewrite every published page, its images and the site settings to GitHub in one commit? Use this after moving or resetting the repository.', { confirmLabel: 'Republish' }))) return;
        republishButton.disabled = true;
        try {
            const res = await post('/api/republish');
            toast(`Republished ${res.pages} page(s) and ${res.media} image(s)`);
        } catch (err) { showError(err); } finally { republishButton.disabled = false; }
    } }, 'Republish all content');

    const { sessions } = await get('/api/sessions?all=1');
    const c = diag.counts;

    mount(main,
        h('div', { class: 'page-head' }, h('h1', null, 'System')),
        h('div', { class: 'grid-2' },
            h('div', { class: 'panel' },
                h('h2', null, 'Configuration'),
                checksList,
                diag.repository ? h('p', { class: 'small muted' }, `Publishing to ${diag.repository} (branch ${diag.branch})`) : null,
                diag.repository ? testButton : null),
            h('div', { class: 'panel' },
                h('h2', null, 'Content'),
                h('dl', { class: 'kv' },
                    h('dt', null, 'Pages'), h('dd', null, `${c.pages} (${c.published} published, ${c.scheduled} scheduled)`),
                    h('dt', null, 'Images'), h('dd', null, `${c.media} (${formatBytes(c.mediaBytes)})`),
                    h('dt', null, 'Users'), h('dd', null, String(c.users)),
                    h('dt', null, 'Open feedback'), h('dd', null, String(c.openFeedback)),
                    h('dt', null, 'Environment'), h('dd', null, `${diag.environment} · schema v${diag.schemaVersion}`)))),
        h('div', { class: 'panel' },
            h('h2', null, 'Backup and recovery'),
            h('p', null, 'Published pages live in your GitHub repository. Drafts, history, users and unpublished images live in the D1 database: download a backup regularly. To restore, create a new D1 database, bind it, and choose the backup on the setup screen.'),
            h('div', { class: 'row' }, backupButton, republishButton, backupStatus)),
        h('div', { class: 'panel' },
            h('h2', null, 'Active sessions'),
            h('div', { class: 'table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, ['User', 'Signed in', 'Last seen', 'Device', ''].map((t) => h('th', null, t)))),
                h('tbody', null, sessions.map((s) => h('tr', null,
                    h('td', null, s.username, s.current ? h('span', { class: 'badge info' }, ' this session') : null),
                    h('td', { class: 'small' }, `${formatDate(s.createdAt)} · ${s.method}`),
                    h('td', { class: 'small' }, timeAgo(s.lastSeenAt)),
                    h('td', { class: 'small muted' }, `${s.ip || ''} ${(s.userAgent || '').slice(0, 60)}`),
                    h('td', { class: 'actions' }, s.current ? null : h('button', { type: 'button', class: 'small danger', onClick: async () => {
                        try { await del(`/api/sessions/${s.id}`); render(main); } catch (err) { showError(err); }
                    } }, 'Revoke')))))))),
        h('div', { class: 'panel' },
            h('h2', null, 'Free tier limits'),
            h('p', { class: 'muted small' }, 'LOON is designed to run entirely on free plans. When a limit is reached, requests fail until it resets; nothing is billed.'),
            h('dl', { class: 'kv small' }, FREE_TIER.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))));
}
