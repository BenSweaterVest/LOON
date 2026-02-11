#!/usr/bin/env node
/**
 * Cross-platform JS syntax check for functions/api/*.js.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apiDir = path.join(root, 'functions', 'api');

const files = readdirSync(apiDir)
    .filter(name => name.endsWith('.js'))
    .map(name => path.join(apiDir, name));

let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        failed = true;
    }
}

if (failed) {
    process.exit(1);
}
