#!/usr/bin/env node
/**
 * Automate Cloudflare KV namespace setup for LOON.
 *
 * What it does:
 * 1) Creates production and preview KV namespaces via Wrangler.
 * 2) Writes/updates the LOON_DB binding in wrangler.toml.
 * 3) Adds a compatibility alias binding (KV) by default.
 *
 * Usage:
 *   node scripts/setup-kv.mjs
 *   node scripts/setup-kv.mjs --binding LOON_DB
 *   node scripts/setup-kv.mjs --legacy-binding KV
 *   node scripts/setup-kv.mjs --no-legacy-binding
 *   node scripts/setup-kv.mjs --env staging
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const wranglerPath = path.join(projectRoot, 'wrangler.toml');

const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
    const i = args.indexOf(name);
    if (i === -1 || i + 1 >= args.length) return defaultValue;
    return args[i + 1];
};

const BINDING = getArg('--binding', 'LOON_DB');
const DISABLE_LEGACY_BINDING = args.includes('--no-legacy-binding');
const LEGACY_BINDING = DISABLE_LEGACY_BINDING ? '' : getArg('--legacy-binding', 'KV');
const ENV = getArg('--env', '');
const PROD_NAMESPACE_NAME = getArg('--name', BINDING);
const PREVIEW_NAMESPACE_NAME = getArg('--preview-name', `${BINDING}_preview`);
const ENV_FLAG = ENV ? ` --env ${ENV}` : '';

const WRANGLER_CMD = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const BEGIN_MARKER = '# BEGIN AUTO_KV_BINDING';
const END_MARKER = '# END AUTO_KV_BINDING';

function run(cmd) {
    try {
        return execSync(cmd, {
            cwd: projectRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8'
        });
    } catch (err) {
        const out = (err.stdout || '') + '\n' + (err.stderr || '');
        throw new Error(out.trim() || err.message);
    }
}

function parseNamespaceId(output) {
    const trimmed = output.trim();

    // Preferred: Wrangler JSON output
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
            return parsed.id;
        }
        if (parsed?.result?.id) {
            return parsed.result.id;
        }
    } catch {
        // Fall through to text parsing.
    }

    // Fallback: parse text output
    const idMatch = trimmed.match(/\b([a-f0-9]{32})\b/i);
    if (idMatch) return idMatch[1];

    throw new Error(`Unable to parse namespace ID from Wrangler output:\n${trimmed}`);
}

function ensureNamespace(name) {
    const listCmd = `${WRANGLER_CMD} wrangler kv namespace list${ENV_FLAG} --format json`;
    const listRaw = run(listCmd);
    try {
        const parsed = JSON.parse(listRaw);
        const list = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed?.result) ? parsed.result : (Array.isArray(parsed?.result?.namespaces) ? parsed.result.namespaces : []));

        if (Array.isArray(list)) {
            const existing = list.find(item => item?.title === name && typeof item?.id === 'string');
            if (existing) {
                return existing.id;
            }
        }
    } catch {
        // Continue and attempt create.
    }

    // Use --format json where available for stable parsing.
    // Use --env to match target environment/account context.
    const createCmd = `${WRANGLER_CMD} wrangler kv namespace create ${name}${ENV_FLAG} --format json`;
    const output = run(createCmd);
    return parseNamespaceId(output);
}

function upsertWranglerKvBinding(prodId, previewId) {
    if (!fs.existsSync(wranglerPath)) {
        throw new Error(`wrangler.toml not found at ${wranglerPath}`);
    }

    const current = fs.readFileSync(wranglerPath, 'utf8');
    const blocks = [
        BEGIN_MARKER,
        `[[kv_namespaces]]`,
        `binding = "${BINDING}"`,
        `id = "${prodId}"`,
        `preview_id = "${previewId}"`
    ];

    if (LEGACY_BINDING && LEGACY_BINDING !== BINDING) {
        blocks.push(
            '',
            `[[kv_namespaces]]`,
            `binding = "${LEGACY_BINDING}"`,
            `id = "${prodId}"`,
            `preview_id = "${previewId}"`
        );
    }

    blocks.push(END_MARKER);
    const block = blocks.join('\n');

    const markerRegex = new RegExp(`${BEGIN_MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
    let next;

    if (markerRegex.test(current)) {
        next = current.replace(markerRegex, block);
    } else {
        next = `${current.trimEnd()}\n\n${block}\n`;
    }

    fs.writeFileSync(wranglerPath, next, 'utf8');
}

function main() {
    console.log(`Setting up KV binding "${BINDING}" in ${path.basename(wranglerPath)}...`);
    if (LEGACY_BINDING && LEGACY_BINDING !== BINDING) {
        console.log(`Compatibility alias binding enabled: "${LEGACY_BINDING}"`);
    } else if (DISABLE_LEGACY_BINDING) {
        console.log('Compatibility alias binding disabled.');
    }
    if (ENV) {
        console.log(`Using env: ${ENV}`);
    }

    const prodId = ensureNamespace(PROD_NAMESPACE_NAME);
    console.log(`Created namespace "${PROD_NAMESPACE_NAME}" => ${prodId}`);

    const previewId = ensureNamespace(PREVIEW_NAMESPACE_NAME);
    console.log(`Created namespace "${PREVIEW_NAMESPACE_NAME}" => ${previewId}`);

    upsertWranglerKvBinding(prodId, previewId);
    if (LEGACY_BINDING && LEGACY_BINDING !== BINDING) {
        console.log(`Updated wrangler.toml with bindings: ${BINDING}, ${LEGACY_BINDING}.`);
    } else {
        console.log(`Updated wrangler.toml with binding: ${BINDING}.`);
    }
    console.log('Next: run your normal deploy (push to main or wrangler pages deploy).');
}

try {
    main();
} catch (err) {
    console.error('KV setup failed.');
    console.error(err.message || String(err));
    process.exit(1);
}
