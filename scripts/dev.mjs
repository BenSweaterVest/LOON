#!/usr/bin/env node
/**
 * Local development: builds the site, then serves it with Wrangler using the
 * real Functions and a local D1 database (stored in .wrangler/). Rebuilds when
 * public/, src/shared/, templates/ or content/ change.
 *
 *   npm run dev                 http://localhost:8788/admin/
 *   LOON_PORT=9000 npm run dev
 *
 * Local mode runs with LOON_ENV=development: publishing updates D1 only unless
 * you also set GITHUB_REPO and GITHUB_TOKEN in a .dev.vars file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.LOON_PORT || '8788';
const setupToken = process.env.SETUP_TOKEN || 'local-setup-token';

function rebuild(reason) {
    try {
        const result = build({ siteUrl: '' });
        console.log(`[loon] ${reason}: built ${result.pages} page(s) in ${result.ms}ms`);
    } catch (err) {
        console.error(`[loon] build failed: ${err.message}`);
    }
}

rebuild('start');

let timer = null;
for (const dir of ['public', 'src/shared', 'templates', 'content']) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    fs.watch(full, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => rebuild('change'), 150);
    });
}

const args = [
    'wrangler', 'pages', 'dev', 'dist',
    '--port', port,
    '--compatibility-date', '2026-01-01',
    '--d1', 'DB=loon-local',
    '--persist-to', '.wrangler/state',
    '--binding', 'LOON_ENV=development',
    '--binding', `SETUP_TOKEN=${setupToken}`
];

console.log(`[loon] admin: http://localhost:${port}/admin/  (setup token: ${setupToken})`);
const child = spawn('npx', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
