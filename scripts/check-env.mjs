#!/usr/bin/env node
/**
 * Environment/config validation for LOON.
 *
 * Validates:
 * - Required environment variables are present.
 * - GITHUB_REPO format looks correct.
 * - optional local wrangler config can include a KV binding for local development.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const wranglerTomlPath = path.join(projectRoot, 'wrangler.dev.toml');
const wranglerLocalTomlPath = path.join(projectRoot, 'wrangler.local.toml');

const REQUIRED_VARS = ['GITHUB_REPO', 'GITHUB_TOKEN'];
const OPTIONAL_VARS = ['SETUP_TOKEN', 'CORS_ORIGIN', 'CF_ACCOUNT_ID', 'CF_IMAGES_TOKEN'];
const GITHUB_REPO_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function readFileIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
}

function parseEnvFile(content) {
    const vars = {};
    if (!content) return vars;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;

        const key = trimmed.slice(0, eq).trim();
        const rawValue = trimmed.slice(eq + 1).trim();
        const value = rawValue.replace(/^["']|["']$/g, '');
        if (key && value) vars[key] = value;
    }
    return vars;
}

function detectGitHubRepoFromRemote() {
    try {
        const remote = execSync('git remote get-url origin', {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8'
        }).trim();

        // Supports:
        // - https://github.com/owner/repo.git
        // - git@github.com:owner/repo.git
        const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
        if (!match) return null;
        return `${match[1]}/${match[2]}`;
    } catch {
        return null;
    }
}

function parseKvBindingsFromWranglerToml(content) {
    if (!content) return [];
    const bindings = [];
    const regex = /binding\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
        bindings.push(m[1]);
    }
    return bindings;
}

function printLine(label, value = '') {
    console.log(`${label}${value ? ` ${value}` : ''}`);
}

function main() {
    printLine('\nLOON Environment Check');
    printLine('======================\n');

    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const strictCI = process.env.CHECK_ENV_STRICT_CI === 'true';
    const strictMode = !isCI || strictCI;
    const envFiles = ['.env', '.env.local', '.dev.vars'].map(name => path.join(projectRoot, name));
    const fileVars = {};

    if (isCI) {
        printLine('[Info] Running in CI environment; using process env only.');
        if (!strictCI) {
            printLine('[Info]', 'CI defaults to non-strict env presence checks (set CHECK_ENV_STRICT_CI=true to enforce).');
        }
    } else {
        for (const filePath of envFiles) {
            const content = readFileIfExists(filePath);
            if (content) {
                const parsed = parseEnvFile(content);
                Object.assign(fileVars, parsed);
                printLine('[OK] Found', path.basename(filePath));
            }
        }
        if (Object.keys(fileVars).length === 0) {
            printLine('[Warn] No local env file found (.env, .env.local, .dev.vars).');
        }
    }

    const getVar = (name) => process.env[name] || fileVars[name];

    let hasErrors = false;
    printLine('\nRequired Variables:');
    for (const key of REQUIRED_VARS) {
        const value = getVar(key);
        if (value) {
            printLine('[OK]', key);
        } else {
            if (strictMode) {
                hasErrors = true;
                printLine('[Missing]', key);
            } else {
                printLine('[Warn]', `${key} not set in CI environment`);
            }
        }
    }

    const githubRepo = getVar('GITHUB_REPO');
    if (githubRepo) {
        if (GITHUB_REPO_REGEX.test(githubRepo)) {
            printLine('[OK]', `GITHUB_REPO format: ${githubRepo}`);
        } else {
            hasErrors = true;
            printLine('[Invalid]', `GITHUB_REPO format is invalid: ${githubRepo}`);
        }
    }

    const guessedRepo = detectGitHubRepoFromRemote();
    if (!githubRepo && guessedRepo) {
        printLine('[Hint]', `Detected repo from git remote: ${guessedRepo}`);
    }

    printLine('\nOptional Variables:');
    for (const key of OPTIONAL_VARS) {
        const value = getVar(key);
        printLine(value ? '[OK]' : '[Not Set]', key);
    }

    printLine('\nLocal Wrangler KV Binding Check (optional):');
    const wranglerToml = readFileIfExists(wranglerTomlPath);
    const wranglerLocalToml = readFileIfExists(wranglerLocalTomlPath);
    if (!wranglerToml && !wranglerLocalToml) {
        printLine('[Info]', 'No local Wrangler config found (wrangler.dev.toml or wrangler.local.toml).');
    } else {
        const sources = [];
        if (wranglerToml) sources.push({ name: 'wrangler.dev.toml', content: wranglerToml });
        if (wranglerLocalToml) sources.push({ name: 'wrangler.local.toml', content: wranglerLocalToml });

        const bindingSet = new Set();
        for (const source of sources) {
            const bindings = parseKvBindingsFromWranglerToml(source.content);
            if (bindings.length) {
                printLine('[OK]', `${source.name} bindings: ${bindings.join(', ')}`);
                bindings.forEach(b => bindingSet.add(b));
            } else {
                printLine('[Warn]', `No kv_namespaces binding found in ${source.name}`);
            }
        }

        const mergedBindings = Array.from(bindingSet);
        if (mergedBindings.length === 0) {
            printLine('[Hint]', 'Run: npm run setup:kv (writes untracked wrangler.local.toml)');
        } else if (mergedBindings.includes('LOON_DB')) {
            printLine('[OK]', 'Preferred binding LOON_DB is present');
        } else if (mergedBindings.includes('KV')) {
            printLine('[Warn]', 'Only KV binding present; runtime supports it but LOON_DB is preferred');
        } else {
            printLine('[Warn]', 'Neither LOON_DB nor KV binding found');
            printLine('[Hint]', 'Run: npm run setup:kv');
        }
    }

    printLine('\n======================');
    if (hasErrors) {
        printLine('[FAIL] Missing/invalid required configuration.');
        printLine('Fix required variables, then rerun: npm run check:env\n');
        process.exit(1);
    }

    if (strictMode) {
        printLine('[PASS] Required configuration is present.\n');
    } else {
        printLine('[PASS] CI environment check passed (non-strict mode).\n');
    }
    process.exit(0);
}

main();
