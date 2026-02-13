import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const summaryPath = resolve('coverage', 'coverage-summary.json');
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

const TARGETS = [
    { file: 'functions/lib/github.js', minLines: 75 },
    { file: 'functions/lib/page-id.js', minLines: 80 },
    { file: 'functions/lib/rate-limit.js', minLines: 80 },
    { file: 'functions/lib/session.js', minLines: 80 }
];

function findEntry(targetFile) {
    const normalizedTarget = targetFile.replace(/\\/g, '/');
    return Object.entries(summary).find(([key]) => key.replace(/\\/g, '/').endsWith(normalizedTarget));
}

const failures = [];
for (const target of TARGETS) {
    const entry = findEntry(target.file);
    if (!entry) {
        failures.push(`${target.file}: missing from coverage summary`);
        continue;
    }
    const [, metrics] = entry;
    const linesPct = metrics?.lines?.pct ?? 0;
    if (linesPct < target.minLines) {
        failures.push(`${target.file}: lines ${linesPct}% < ${target.minLines}%`);
    }
}

if (failures.length > 0) {
    console.error('Helper coverage check failed:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log('Helper coverage check passed.');
