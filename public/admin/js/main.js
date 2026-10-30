/**
 * Admin entry point: decides between setup, sign-in and the app shell, and
 * runs a small hash router (#/pages, #/pages/<id>, ...).
 */

import { get, onAuthEvent } from './api.js';
import { h, mount, showError } from './dom.js';
import { hasRole, refreshMe, state } from './state.js';
import { renderSetup } from './views/setup.js';
import { renderLogin, renderPasswordChange } from './views/login.js';
import { getLeaveGuard, setLeaveGuard } from './nav.js';

const app = document.getElementById('app');

const ROUTES = [
    { pattern: /^\/pages\/?$/, load: () => import('./views/pages.js'), label: 'Pages', nav: '/pages', role: 'contributor' },
    { pattern: /^\/pages\/([a-z0-9-]+)$/, load: () => import('./views/editor.js'), nav: '/pages', role: 'contributor' },
    { pattern: /^\/media\/?$/, load: () => import('./views/media.js'), label: 'Media', nav: '/media', role: 'contributor' },
    { pattern: /^\/activity\/?$/, load: () => import('./views/activity.js'), label: 'Activity', nav: '/activity', role: 'contributor' },
    { pattern: /^\/blocks\/?$/, load: () => import('./views/blocks.js'), label: 'Blocks', nav: '/blocks', role: 'editor' },
    { pattern: /^\/feedback\/?$/, load: () => import('./views/feedback.js'), label: 'Feedback', nav: '/feedback', role: 'editor' },
    { pattern: /^\/users\/?$/, load: () => import('./views/users.js'), label: 'Users', nav: '/users', role: 'admin', section: 'Admin' },
    { pattern: /^\/settings\/?$/, load: () => import('./views/settings.js'), label: 'Site settings', nav: '/settings', role: 'admin', section: 'Admin' },
    { pattern: /^\/system\/?$/, load: () => import('./views/system.js'), label: 'System', nav: '/system', role: 'admin', section: 'Admin' },
    { pattern: /^\/account\/?$/, load: () => import('./views/account.js'), label: 'My account', nav: '/account', role: 'contributor', section: 'You' }
];

let shell = null;
let currentHash = '';

function buildShell() {
    const nav = h('nav', { 'aria-label': 'Admin' });
    let section = null;
    for (const route of ROUTES) {
        if (!route.label || !hasRole(route.role)) continue;
        if (route.section !== section) {
            section = route.section;
            if (section) nav.append(h('div', { class: 'section-label' }, section));
        }
        nav.append(h('a', { href: `#${route.nav}`, dataset: { nav: route.nav } }, route.label));
    }
    const main = h('main', { class: 'main', id: 'main' });
    const toggle = h('button', { class: 'menu-toggle icon', type: 'button', 'aria-label': 'Menu', onClick: () => root.classList.toggle('nav-open') }, '☰');
    const signOut = h('button', { class: 'link small', type: 'button', onClick: signOutNow }, 'Sign out');
    const root = h('div', { class: 'shell' },
        h('aside', { class: 'sidebar' },
            h('div', { class: 'brand' }, h('a', { href: '#/pages' }, 'LOON'), h('a', { class: 'small', href: '/', target: '_blank', rel: 'noopener' }, 'View site ↗')),
            nav,
            h('div', { class: 'spacer' }),
            h('div', { class: 'user' },
                h('div', null, h('strong', null, state.user.displayName)),
                h('div', { class: 'muted small' }, `${state.user.username} · ${state.user.role}`),
                signOut)),
        h('div', null, h('div', { class: 'row' }, toggle), main));
    mount(app, root);
    root.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar nav a')) root.classList.remove('nav-open');
    });
    return { root, main, nav };
}

async function signOutNow() {
    const guard = getLeaveGuard();
    if (guard && !(await guard())) return;
    setLeaveGuard(null);
    try {
        const { post } = await import('./api.js');
        await post('/api/auth/logout');
    } catch { /* already signed out */ }
    state.user = null;
    shell = null;
    location.hash = '';
    start();
}

async function route() {
    if (!state.user) return;
    const path = location.hash.replace(/^#/, '') || '/pages';
    if (`#${path}` === currentHash) return;
    const guard = getLeaveGuard();
    if (guard) {
        const ok = await guard();
        if (!ok) {
            history.replaceState(null, '', currentHash || '#/pages');
            return;
        }
        setLeaveGuard(null);
    }
    currentHash = `#${path}`;
    const match = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m && hasRole(x.r.role));
    if (!shell) shell = buildShell();
    for (const a of shell.nav.querySelectorAll('a')) a.classList.toggle('active', !!match && a.dataset.nav === match.r.nav);
    if (!match) {
        mount(shell.main, h('div', { class: 'empty' }, 'Page not found. ', h('a', { href: '#/pages' }, 'Go to pages')));
        return;
    }
    mount(shell.main, h('p', { class: 'loading' }, h('span', { class: 'spinner' }), ' Loading…'));
    try {
        const view = await match.r.load();
        await view.render(shell.main, ...match.m.slice(1));
        const heading = shell.main.querySelector('h1');
        document.title = `${heading ? heading.textContent : 'Admin'} · LOON`;
    } catch (err) {
        if (err?.status === 401) return;
        mount(shell.main, h('div', { class: 'notice danger' }, h('p', null, err.message || 'Could not load this page.')));
        console.error(err);
    }
}

async function start() {
    currentHash = '';
    try {
        const user = await refreshMe();
        if (!user) {
            const setup = await get('/api/setup', { quiet: true });
            if (setup.needsSetup) return renderSetup(app, setup, start);
            return renderLogin(app, start);
        }
        if (user.mustChangePassword) return renderPasswordChange(app, start);
        shell = null;
        await route();
    } catch (err) {
        mount(app, h('div', { class: 'auth' }, h('div', { class: 'card' },
            h('h1', null, 'LOON is not ready'),
            h('p', null, err.message),
            h('p', { class: 'muted small' }, 'If you just deployed, check that a D1 database is bound to this Pages project as DB, then reload.'),
            h('button', { type: 'button', onClick: () => location.reload() }, 'Reload'))));
    }
}

onAuthEvent((event) => {
    if (event === 'signed-out' && state.user) {
        state.user = null;
        shell = null;
        setLeaveGuard(null);
        showError({ message: 'Your session ended. Please sign in again.' });
        start();
    }
    if (event === 'password-change') start();
});

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (event) => {
    const guard = getLeaveGuard();
    if (guard && guard.dirty && guard.dirty()) {
        event.preventDefault();
        event.returnValue = '';
    }
});

start();
