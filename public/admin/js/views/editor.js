/**
 * Page editor: schema-driven form, live preview, drafts with conflict
 * detection, local backups, publishing, scheduling, review and history.
 */

import { get, post, put, del } from '../api.js';
import { confirmDialog, debounce, field, formatDate, h, mount, openDialog, showError, storage, timeAgo, toast } from '../dom.js';
import { hasRole, loadSettings, state } from '../state.js';
import { navigate, setLeaveGuard } from '../nav.js';
import { buildForm } from '../lib/fields.js';
import { loadMedia, onMediaReady, resolveMediaUrl } from '../lib/media.js';
import { editSchema } from '../lib/schema-editor.js';
import { diffContent } from '../lib/diff.js';
import { statusBadges } from './pages.js';
import { renderPage } from '/assets/shared/render.js';
import { DEFAULT_SETTINGS } from '/assets/shared/site.js';
import { isValidPageId, slugify } from '/assets/shared/page-id.js';

const KIND_LABELS = { create: 'Created', save: 'Saved', publish: 'Published', unpublish: 'Unpublished', restore: 'Restored', rollback: 'Rolled back' };

function toLocalInput(ms) {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
}

export async function render(main, id) {
    const [{ page: loaded }, watches] = await Promise.all([
        get(`/api/pages/${id}`),
        get('/api/watches').catch(() => ({ pages: [] })),
        loadMedia().catch(() => null)
    ]);
    const settings = await loadSettings().catch(() => DEFAULT_SETTINGS);
    const editor = hasRole('editor');
    const store = storage();
    const backupKey = `loon:draft:${id}`;

    let page = loaded;
    let data = structuredClone(page.data);
    let title = page.title;
    let schema = page.schema;
    let schemaChanged = false;
    let dirty = false;
    let busy = false;
    let watching = watches.pages.some((w) => w.pageId === id);
    let showPreview = store?.getItem('loon:preview') !== 'off';
    let mobilePreview = false;

    const heading = h('h1');
    const badges = h('div', { class: 'row' });
    const statusText = h('span', { class: 'editor-status', role: 'status' });
    const notices = h('div');
    const formHost = h('div');
    const iframe = h('iframe', { title: 'Page preview', sandbox: 'allow-same-origin' });
    const previewPane = h('div', { class: 'preview' },
        h('div', { class: 'preview-bar' }, h('span', null, 'Live preview'),
            h('button', { type: 'button', class: 'small link', onClick: () => {
                mobilePreview = !mobilePreview;
                previewPane.classList.toggle('mobile', mobilePreview);
            } }, 'Toggle phone width')),
        iframe);
    const layout = h('div', { class: 'editor' });
    let form = null;

    const titleInput = h('input', { type: 'text', value: title, maxlength: 200 });
    titleInput.addEventListener('input', () => {
        title = titleInput.value;
        changed();
    });

    // --- Preview -----------------------------------------------------------
    const drawPreview = debounce(() => {
        if (!showPreview) return;
        iframe.srcdoc = renderPage(
            { id, title, template: page.template, schema, data, publishedAt: Date.now() },
            settings,
            { resolveUrl: resolveMediaUrl, scripts: false, feedback: false, noindex: true }
        );
    }, 250);
    const stopMedia = onMediaReady(() => {
        if (!iframe.isConnected) return stopMedia();
        drawPreview();
        return undefined;
    });

    // --- Local backup ------------------------------------------------------
    const backup = debounce(() => {
        if (!store) return;
        try {
            store.setItem(backupKey, JSON.stringify({ version: page.version, title, data, schema: schemaChanged ? schema : null, at: Date.now() }));
        } catch { /* storage full or blocked */ }
    }, 800);
    const clearBackup = () => {
        backup.cancel();
        store?.removeItem(backupKey);
    };

    function changed() {
        dirty = true;
        drawStatus();
        drawPreview();
        backup();
    }

    function drawForm() {
        form = buildForm(schema, data, changed);
        mount(formHost, form.element);
    }

    function drawStatus() {
        heading.textContent = title || page.id;
        mount(badges, statusBadges(page));
        statusText.textContent = dirty
            ? 'Unsaved changes'
            : `Saved ${timeAgo(page.updatedAt)} by ${page.updatedBy} · version ${page.version}`;
        drawActions();
    }

    // --- Saving ------------------------------------------------------------
    async function save({ quiet = false } = {}) {
        if (busy) return false;
        busy = true;
        drawActions();
        try {
            const body = { baseVersion: page.version, title, data };
            if (schemaChanged) body.schema = schema;
            const res = await put(`/api/pages/${id}`, body);
            page = res.page;
            schemaChanged = false;
            dirty = false;
            clearBackup();
            form.showErrors([]);
            if (!quiet) toast('Draft saved');
            return true;
        } catch (err) {
            if (err.code === 'version_conflict') {
                await resolveConflict(err);
            } else {
                if (Array.isArray(err.details)) form.showErrors(err.details);
                showError(err);
            }
            return false;
        } finally {
            busy = false;
            drawStatus();
        }
    }

    async function resolveConflict(err) {
        const who = err.details?.updatedBy || 'someone else';
        const when = err.details?.updatedAt ? timeAgo(err.details.updatedAt) : 'recently';
        const choice = await openDialog({
            title: 'This page was changed',
            body: h('div', null,
                h('p', null, `${who} saved a newer version ${when}.`),
                h('p', null, 'You can load their version (your edits stay in this browser as a backup and in the page history if you save them later), or save yours on top of theirs.')),
            actions: [
                { label: 'Cancel', value: null },
                { label: 'Load their version', value: 'theirs' },
                { label: 'Save mine anyway', value: 'mine', danger: true }
            ]
        });
        if (choice === 'theirs') {
            backup.flush();
            render(main, id);
        } else if (choice === 'mine') {
            const latest = (await get(`/api/pages/${id}`)).page;
            page = { ...page, version: latest.version };
            busy = false;
            await save();
        }
    }

    // --- Publishing --------------------------------------------------------
    async function publish() {
        if (dirty && !(await save({ quiet: true }))) return;
        const live = page.status !== 'draft';
        const ok = await confirmDialog(live ? 'Publish changes' : 'Publish page', `${live ? 'Update' : 'Publish'} /${id}/ with this draft? The live site updates in about a minute.`, { confirmLabel: 'Publish' });
        if (!ok) return;
        await run(async () => {
            try {
                await post('/api/publish', { pages: [{ id, version: page.version }] });
            } catch (err) {
                if (Array.isArray(err.details)) form.showErrors(err.details);
                throw err;
            }
            toast('Published. The site will update shortly.');
        });
    }

    async function run(task) {
        busy = true;
        drawActions();
        try {
            await task();
            page = (await get(`/api/pages/${id}`)).page;
        } catch (err) {
            showError(err);
        } finally {
            busy = false;
            drawStatus();
        }
    }

    async function schedule() {
        if (dirty && !(await save({ quiet: true }))) return;
        const input = h('input', { type: 'datetime-local', required: true, min: toLocalInput(Date.now() + 60000), value: toLocalInput(page.scheduledFor || Date.now() + 3600000) });
        const at = await openDialog({
            title: 'Schedule publishing',
            body: h('div', null,
                field('Publish at (your local time)', input),
                h('p', { class: 'help' }, 'The latest saved draft is published at that time. Scheduled publishing runs every 15 minutes via the site cron, and whenever an editor opens the page list.')),
            actions: [{ label: 'Cancel', value: null }, { label: 'Schedule', value: 'ok', primary: true, submit: true }],
            onSubmit: () => new Date(input.value).getTime()
        });
        if (!at) return;
        await run(async () => {
            await put(`/api/pages/${id}/schedule`, { at });
            toast(`Scheduled for ${formatDate(at)}`);
        });
    }

    async function workflow(action) {
        let note = '';
        if (action === 'reject') {
            const input = h('textarea', { rows: 3, maxlength: 500, placeholder: 'What should change?' });
            const result = await openDialog({
                title: 'Send back to author',
                body: field('Note for the author (optional)', input),
                actions: [{ label: 'Cancel', value: null }, { label: 'Send back', value: 'ok', primary: true }]
            });
            if (!result) return;
            note = input.value;
        }
        if (action === 'submit' && dirty && !(await save({ quiet: true }))) return;
        await run(async () => {
            await post(`/api/pages/${id}/workflow`, { action, note });
            toast({ submit: 'Submitted for review', withdraw: 'Withdrawn from review', reject: 'Sent back to the author' }[action]);
        });
    }

    // --- History -----------------------------------------------------------
    async function showHistory() {
        const { revisions } = await get(`/api/pages/${id}/revisions`);
        let closeHistory = () => {};
        const compareBox = h('div');
        const listEl = h('ul', { class: 'revisions' }, revisions.map((rev) => h('li', null,
            h('div', null,
                h('strong', null, `${KIND_LABELS[rev.kind] || rev.kind} · v${rev.version}`),
                h('div', { class: 'muted small' }, `${rev.createdBy} · ${formatDate(rev.createdAt)}${rev.note ? ` · ${rev.note}` : ''}`)),
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'small', onClick: () => compare(rev) }, 'Compare'),
                h('button', { type: 'button', class: 'small', onClick: () => restore(rev) }, 'Restore to draft'),
                editor && ['publish', 'rollback'].includes(rev.kind) && page.published
                    ? h('button', { type: 'button', class: 'small danger', onClick: () => rollback(rev) }, 'Roll back live page')
                    : null))));

        async function compare(rev) {
            const { revision } = await get(`/api/pages/${id}/revisions/${rev.id}`);
            const changes = diffContent(schema, revision.data, data);
            if (revision.title !== title) changes.unshift({ label: 'Page name', lines: [{ type: 'del', text: revision.title }, { type: 'add', text: title }] });
            mount(compareBox,
                h('h3', null, `Changes from v${rev.version} to your current draft`),
                changes.length
                    ? changes.map((c) => [h('strong', null, c.label), h('div', { class: 'diff' }, c.lines.map((l) => h('div', { class: l.type }, `${l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}${l.text}`)))])
                    : h('p', { class: 'muted' }, 'No differences.'));
            compareBox.scrollIntoView({ behavior: 'smooth' });
        }

        async function restore(rev) {
            if (dirty && !(await confirmDialog('Discard unsaved changes?', 'Restoring replaces the draft, including your unsaved edits.', { confirmLabel: 'Restore', danger: true }))) return;
            try {
                await post(`/api/pages/${id}/revisions/${rev.id}/restore`, { baseVersion: page.version });
                closeHistory(null);
                dirty = false;
                clearBackup();
                toast(`Restored version ${rev.version} into the draft`);
                render(main, id);
            } catch (err) { showError(err); }
        }

        async function rollback(rev) {
            if (!(await confirmDialog('Roll back the live page?', `The live page and the draft both return to version ${rev.version}. Unsaved edits are discarded.`, { confirmLabel: 'Roll back', danger: true }))) return;
            try {
                await post(`/api/pages/${id}/rollback`, { revisionId: rev.id, baseVersion: page.version });
                closeHistory(null);
                dirty = false;
                clearBackup();
                toast('Rolled back. The site will update shortly.');
                render(main, id);
            } catch (err) { showError(err); }
        }

        await openDialog({
            title: 'Page history',
            wide: true,
            body: (form, close) => {
                closeHistory = close;
                return h('div', null, listEl, compareBox);
            }
        });
    }

    // --- Other actions -----------------------------------------------------
    async function toggleWatch() {
        try {
            if (watching) await del(`/api/watches/${id}`); else await put(`/api/watches/${id}`);
            watching = !watching;
            toast(watching ? 'You will see changes by others under Activity' : 'Stopped watching');
            drawActions();
        } catch (err) { showError(err); }
    }

    async function duplicate() {
        const newId = h('input', { type: 'text', required: true, class: 'mono', value: slugify(`${id}-copy`) });
        const newTitle = h('input', { type: 'text', required: true, value: `${title} (copy)` });
        const created = await openDialog({
            title: 'Duplicate page',
            body: h('div', null, field('Title', newTitle), field('Page ID', newId)),
            actions: [{ label: 'Cancel', value: null }, { label: 'Duplicate', value: 'ok', primary: true, submit: true }],
            onSubmit: async () => {
                if (!isValidPageId(newId.value)) throw new Error('That page ID is not allowed');
                return (await post(`/api/pages/${id}/duplicate`, { id: newId.value, title: newTitle.value })).page.id;
            }
        });
        if (created) navigate(`/pages/${created}`);
    }

    async function remove() {
        const ok = await confirmDialog('Delete page', page.published
            ? `This unpublishes /${id}/ and deletes the page and its history. This cannot be undone.`
            : 'This deletes the page and its history. This cannot be undone.', { confirmLabel: 'Delete page', danger: true });
        if (!ok) return;
        try {
            await del(`/api/pages/${id}`);
            dirty = false;
            clearBackup();
            setLeaveGuard(null);
            toast('Page deleted');
            navigate('/pages');
        } catch (err) { showError(err); }
    }

    async function changeSchema() {
        const next = await editSchema(schema);
        if (!next) return;
        schema = next;
        schemaChanged = true;
        drawForm();
        changed();
        toast('Fields updated. Save the draft to keep them.');
    }

    function togglePreview() {
        showPreview = !showPreview;
        store?.setItem('loon:preview', showPreview ? 'on' : 'off');
        drawLayout();
        drawActions();
    }

    // --- Action bar --------------------------------------------------------
    const headActions = h('div', { class: 'actions' });
    const saveActions = h('div', { class: 'row' });

    function drawActions() {
        const own = page.createdBy === state.user.username;
        const btn = (label, onClick, cls = '') => h('button', { type: 'button', class: cls, disabled: busy, onClick }, label);
        mount(headActions,
            page.published ? h('a', { class: 'button small', href: `/${id}/`, target: '_blank', rel: 'noopener' }, 'View live ↗') : null,
            btn(showPreview ? 'Hide preview' : 'Show preview', togglePreview, 'small'),
            btn(watching ? 'Unwatch' : 'Watch', toggleWatch, 'small'),
            btn('History', () => showHistory().catch(showError), 'small'),
            btn('Duplicate', duplicate, 'small'),
            editor ? btn('Fields', changeSchema, 'small') : null,
            editor ? btn('Delete', remove, 'small danger') : null);

        const items = [btn(busy ? 'Working…' : 'Save draft', () => save(), dirty ? 'primary' : '')];
        if (editor) {
            if (page.status === 'published' && !dirty) {
                items.push(h('button', { type: 'button', disabled: true, title: 'The live page matches this draft' }, 'Up to date'));
            } else {
                items.push(btn(page.status === 'draft' ? 'Publish' : 'Publish changes', publish, dirty ? '' : 'primary'));
            }
            items.push(btn(page.scheduledFor ? 'Reschedule' : 'Schedule', schedule));
            if (page.scheduledFor) items.push(btn('Cancel schedule', () => run(async () => { await del(`/api/pages/${id}/schedule`); toast('Schedule cancelled'); })));
            if (page.published) {
                items.push(btn('Unpublish', async () => {
                    if (!(await confirmDialog('Unpublish page', `Remove /${id}/ from the live site? The draft is kept.`, { confirmLabel: 'Unpublish', danger: true }))) return;
                    await run(async () => { await post('/api/unpublish', { pages: [id] }); toast('Unpublished'); });
                }, 'danger'));
            }
            if (page.workflow === 'review') items.push(btn('Send back', () => workflow('reject')));
        } else if (own || page.workflow === 'review') {
            if (page.workflow === 'draft') items.push(btn('Submit for review', () => workflow('submit'), dirty ? '' : 'primary'));
            else items.push(btn('Withdraw from review', () => workflow('withdraw')));
        }
        mount(saveActions, items);
    }

    function drawLayout() {
        layout.classList.toggle('no-preview', !showPreview);
        mount(layout, h('div', { class: 'editor-form' }, notices,
            h('details', { class: 'panel' },
                h('summary', null, h('strong', null, 'Page settings')),
                h('div', { class: 'grid-2' },
                    field('Page name', titleInput, { help: 'Shown in the admin page list.' }),
                    h('div', { class: 'field' }, h('label', null, 'Address'), h('p', { class: 'mono' }, `/${id}/`),
                        h('p', { class: 'help' }, `Template: ${page.template || 'custom'} · created by ${page.createdBy} ${timeAgo(page.createdAt)}`)))),
            h('div', { class: 'panel' }, formHost),
            h('div', { class: 'savebar' }, statusText, saveActions)),
        showPreview ? previewPane : null);
        if (showPreview) drawPreview.flush();
    }

    // --- Notices -----------------------------------------------------------
    function drawNotices() {
        const items = [];
        if (page.workflow === 'review') {
            items.push(h('div', { class: 'notice info' }, h('p', null, editor
                ? 'This page is waiting for review. Publish it, or send it back with a note.'
                : 'Submitted for review. An editor will publish it or send it back.')));
        }
        const saved = store ? JSON.parse(store.getItem(backupKey) || 'null') : null;
        if (saved && JSON.stringify(saved.data) !== JSON.stringify(page.data)) {
            const stale = saved.version !== page.version;
            items.push(h('div', { class: 'notice warn' },
                h('p', null, `You have unsaved edits from ${timeAgo(saved.at)} in this browser.${stale ? ' The page has been saved by someone since then; restoring will overwrite their changes when you save.' : ''}`),
                h('div', { class: 'row' },
                    h('button', { type: 'button', class: 'small primary', onClick: () => {
                        data = saved.data;
                        title = saved.title;
                        titleInput.value = title;
                        if (saved.schema) { schema = saved.schema; schemaChanged = true; }
                        drawForm();
                        changed();
                        mount(notices);
                    } }, 'Restore my edits'),
                    h('button', { type: 'button', class: 'small', onClick: () => { clearBackup(); mount(notices); } }, 'Discard'))));
        }
        mount(notices, items);
    }

    setLeaveGuard(Object.assign(
        async () => !dirty || confirmDialog('Leave without saving?', 'Your unsaved edits stay in this browser and will be offered next time you open this page.', { confirmLabel: 'Leave', danger: true }),
        { dirty: () => dirty }
    ));

    layout.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            save();
        }
    });

    mount(main,
        h('div', { class: 'page-head' }, h('div', null, heading, badges), headActions),
        layout);
    drawForm();
    drawNotices();
    drawStatus();
    drawLayout();
}
