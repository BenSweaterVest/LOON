#!/usr/bin/env node
/**
 * Create the first LOON admin user directly in Cloudflare KV using Wrangler.
 *
 * Prerequisite:
 *   - `npm run setup:kv` already completed (or equivalent local kv_namespaces config)
 *
 * Usage:
 *   LOON_ADMIN_PASSWORD='YourSecurePassword123' npm run setup:admin -- --username admin
 *   npm run setup:admin -- --username admin --password YourSecurePassword123
 *
 * Notes:
 *   - Creates bootstrap user record in KV (password re-hashed on first login).
 *   - Refuses to overwrite existing user unless `--force` is passed.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
    const i = args.indexOf(name);
    if (i === -1 || i + 1 >= args.length) return fallback;
    return args[i + 1];
};

const hasFlag = name => args.includes(name);

const usernameRaw = getArg('--username', 'admin');
const password = getArg('--password', process.env.LOON_ADMIN_PASSWORD || null);
const binding = getArg('--binding', 'LOON_DB');
const wranglerConfigFile = getArg('--config', null);
const force = hasFlag('--force');

function fail(message) {
    console.error(message);
    process.exit(1);
}

function normalizeUsername(input) {
    if (!input || typeof input !== 'string') return null;
    const normalized = input.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (normalized.length < 3 || normalized.length > 32) return null;
    return normalized;
}

function resolveWranglerConfigPath() {
    if (wranglerConfigFile) {
        return path.join(projectRoot, wranglerConfigFile);
    }
    const localPath = path.join(projectRoot, 'wrangler.local.toml');
    const defaultPath = path.join(projectRoot, 'wrangler.dev.toml');
    try {
        readFileSync(localPath, 'utf8');
        return localPath;
    } catch {
        return defaultPath;
    }
}

function getNamespaceIdFromWranglerToml(bindingName, wranglerPath) {
    const text = readFileSync(wranglerPath, 'utf8');

    // Match the first kv_namespaces block for the requested binding.
    const blockRegex = /\[\[kv_namespaces\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g;
    const blocks = text.match(blockRegex) || [];

    for (const block of blocks) {
        const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"\s*$/m);
        if (!bindingMatch || bindingMatch[1] !== bindingName) continue;

        const idMatch = block.match(/^\s*id\s*=\s*"([^"]+)"\s*$/m);
        if (!idMatch) continue;

        return idMatch[1];
    }

    return null;
}

function runWrangler(argsList) {
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return spawnSync(cmd, argsList, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
    });
}

function runWranglerKvKey(action, namespaceId, key, value = null) {
    const modern = ['wrangler', 'kv', 'key', action, '--namespace-id', namespaceId, key];
    const legacy = ['wrangler', 'kv:key', action, '--namespace-id', namespaceId, key];
    if (value !== null) {
        modern.push(value);
        legacy.push(value);
    }

    const modernResult = runWrangler(modern);
    if (modernResult.status === 0) return { ok: true, result: modernResult, combinedStderr: modernResult.stderr || '' };

    const legacyResult = runWrangler(legacy);
    if (legacyResult.status === 0) return { ok: true, result: legacyResult, combinedStderr: legacyResult.stderr || '' };

    const combinedStderr = `${modernResult.stderr || ''}\n${legacyResult.stderr || ''}`.trim();
    return { ok: false, result: null, combinedStderr };
}

function keyExists(namespaceId, key) {
    const response = runWranglerKvKey('get', namespaceId, key);
    if (response.ok) {
        return ((response.result.stdout || '').trim().length > 0);
    }

    const errLower = response.combinedStderr.toLowerCase();
    if (errLower.includes('not found') || errLower.includes('404')) {
        return false;
    }

    fail([
        'Failed to check existing admin key.',
        response.combinedStderr || '(no stderr output)'
    ].join('\n'));
}

function createBootstrapUser(username, plainPassword) {
    return {
        username,
        role: 'admin',
        password: plainPassword,
        bootstrap: true,
        created: new Date().toISOString(),
        lastLogin: null,
        mfaEnabled: false,
        passkeysEnabled: false,
        createdBy: 'setup-admin-script'
    };
}

function main() {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
        fail('Invalid username. Use 3-32 chars: lowercase letters, numbers, "_" or "-".');
    }

    if (!password || password.length < 8) {
        fail('Password required (min 8 chars). Provide --password or LOON_ADMIN_PASSWORD env var.');
    }

    const wranglerPath = resolveWranglerConfigPath();
    const namespaceId = getNamespaceIdFromWranglerToml(binding, wranglerPath);
    if (!namespaceId) {
        fail(`No kv namespace ID found for binding "${binding}" in ${path.basename(wranglerPath)}. Run npm run setup:kv first.`);
    }

    const key = `user:${username}`;

    const exists = keyExists(namespaceId, key);
    if (exists && !force) {
        fail(`User "${username}" already exists. Use --force to overwrite.`);
    }

    const user = createBootstrapUser(username, password);
    const putResult = runWranglerKvKey('put', namespaceId, key, JSON.stringify(user));
    if (!putResult.ok) {
        fail([
            'Failed to write admin user to KV.',
            putResult.combinedStderr || '(no stderr output)'
        ].join('\n'));
    }

    console.log(`Created admin bootstrap user "${username}" in namespace ${namespaceId}.`);
    console.log('Next step: log in at /admin.html to trigger password hash upgrade.');
}

main();
