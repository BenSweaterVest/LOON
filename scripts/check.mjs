#!/usr/bin/env node
/**
 * Static checks that tests do not cover:
 *   - every JS file parses
 *   - every JSON file parses; templates validate against the schema rules
 *   - admin and site files stay compatible with the strict CSP
 *     (no inline scripts, inline styles, inline handlers or innerHTML)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateContent, validateSchema } from '../src/shared/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', 'coverage']);
const problems = [];

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f);

for (const file of files.filter((f) => /\.(m?js)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`))) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
        problems.push(`${rel(file)}: syntax error\n${err.stderr.toString().split('\n').slice(0, 4).join('\n')}`);
    }
}

for (const file of files.filter((f) => f.endsWith('.json') && !f.endsWith('package-lock.json'))) {
    try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        problems.push(`${rel(file)}: invalid JSON (${err.message})`);
    }
}

for (const file of files.filter((f) => f.endsWith(`${path.sep}template.json`))) {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { schema, errors } = validateSchema(t.schema);
    if (!t.title) problems.push(`${rel(file)}: missing title`);
    errors.forEach((e) => problems.push(`${rel(file)}: ${e}`));
    validateContent(schema, t.sample || {}).errors.forEach((e) => problems.push(`${rel(file)}: sample ${e.message}`));
}

const csp = files.filter((f) => f.startsWith(path.join(ROOT, 'public')) && /\.(html|js)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`));
for (const file of csp) {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.html')) {
        if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) problems.push(`${rel(file)}: inline <script> (blocked by CSP)`);
        if (/\sstyle=/i.test(text) || /<style/i.test(text)) problems.push(`${rel(file)}: inline style (blocked by CSP)`);
        if (/\son[a-z]+=/i.test(text)) problems.push(`${rel(file)}: inline event handler (blocked by CSP)`);
    } else {
        if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text)) problems.push(`${rel(file)}: HTML string injection; build nodes with h() instead`);
        if (/setAttribute\(\s*['"]style['"]/.test(text)) problems.push(`${rel(file)}: style attribute (blocked by CSP)`);
    }
}

if (problems.length) {
    console.error(`${problems.length} problem(s):\n\n${problems.join('\n')}`);
    process.exit(1);
}
console.log(`check: ${files.length} files OK`);
