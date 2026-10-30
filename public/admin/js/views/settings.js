/**
 * Site settings (admins). Saving publishes content/site.json.
 */

import { get, put, errorLines } from '../api.js';
import { field, h, mount, showError, toast } from '../dom.js';
import { loadSettings, state } from '../state.js';

export async function render(main) {
    const [settings, { pages }] = await Promise.all([loadSettings(true), get('/api/pages')]);
    const published = pages.filter((p) => p.status !== 'draft');
    const nav = structuredClone(settings.navigation || []);

    const siteName = h('input', { type: 'text', required: true, maxlength: 80, value: settings.siteName });
    const tagline = h('input', { type: 'text', maxlength: 200, value: settings.tagline });
    const homePage = h('select', null,
        h('option', { value: '' }, 'List of all pages'),
        published.map((p) => h('option', { value: p.id, selected: p.id === settings.homePage }, `${p.title} (/${p.id}/)`)));
    const language = h('input', { type: 'text', maxlength: 12, value: settings.language, class: 'mono' });
    const accent = h('input', { type: 'color', value: settings.accentColor });
    const feedback = h('input', { type: 'checkbox', checked: settings.feedback });
    const footer = h('textarea', { rows: 3, maxlength: 2000 });
    footer.value = settings.footer;
    const navBox = h('div', { class: 'nav-editor' });

    function drawNav() {
        mount(navBox, nav.map((item, i) => {
            const label = h('input', { type: 'text', value: item.label, placeholder: 'Label', maxlength: 60, 'aria-label': 'Link label' });
            const target = h('input', { type: 'text', value: item.href, placeholder: 'page-id or https://…', list: 'nav-pages', 'aria-label': 'Link target' });
            label.addEventListener('input', () => { item.label = label.value; });
            target.addEventListener('input', () => { item.href = target.value.trim(); });
            return h('div', { class: 'nav-row' }, label, target,
                h('div', { class: 'row' },
                    h('button', { type: 'button', class: 'icon small', 'aria-label': 'Move up', disabled: i === 0, onClick: () => { [nav[i - 1], nav[i]] = [nav[i], nav[i - 1]]; drawNav(); } }, '↑'),
                    h('button', { type: 'button', class: 'icon small danger', 'aria-label': 'Remove', onClick: () => { nav.splice(i, 1); drawNav(); } }, '✕')));
        }),
        h('datalist', { id: 'nav-pages' }, published.map((p) => h('option', { value: p.id }, p.title))),
        h('button', { type: 'button', class: 'small', disabled: nav.length >= 20, onClick: () => { nav.push({ label: '', href: '' }); drawNav(); } }, '+ Add link'));
    }
    drawNav();

    const saveButton = h('button', { type: 'submit', class: 'primary' }, 'Save and publish');
    const form = h('form', {
        onSubmit: async (event) => {
            event.preventDefault();
            saveButton.disabled = true;
            try {
                const res = await put('/api/settings', {
                    siteName: siteName.value, tagline: tagline.value, homePage: homePage.value, language: language.value.trim(),
                    accentColor: accent.value, feedback: feedback.checked, footer: footer.value,
                    navigation: nav.filter((n) => n.label || n.href)
                });
                state.settings = res.settings;
                toast('Settings saved. The site will update shortly.');
            } catch (err) {
                showError({ message: [err.message, ...errorLines(err)].join(' · ') });
            } finally {
                saveButton.disabled = false;
            }
        }
    },
    h('div', { class: 'panel' },
        h('h2', null, 'Identity'),
        h('div', { class: 'grid-2' }, field('Site name', siteName, { required: true }), field('Tagline', tagline)),
        h('div', { class: 'grid-2' },
            field('Home page', homePage, { help: 'Only published pages can be the home page.' }),
            field('Language code', language, { help: 'For example en, es or fr-CA.' })),
        h('div', { class: 'grid-2' },
            field('Accent color', accent),
            h('div', { class: 'field' }, h('label', null, 'Reader feedback'), h('label', { class: 'check' }, feedback, 'Show a feedback form at the bottom of pages')))),
    h('div', { class: 'panel' }, h('h2', null, 'Navigation'), h('p', { class: 'muted small' }, 'Links in the site header. Use a page ID for your own pages or a full address for other sites.'), navBox),
    h('div', { class: 'panel' }, h('h2', null, 'Footer'), field('Footer text (Markdown)', footer)),
    saveButton);

    mount(main, h('div', { class: 'page-head' }, h('h1', null, 'Site settings')), form);
}
