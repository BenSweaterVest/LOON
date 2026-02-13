#!/usr/bin/env node
/**
 * Restore Cloudflare KV namespace values from JSON backup snapshot.
 *
 * Usage:
 *   node scripts/restore-kv.mjs backups/kv-backup-*.json
 *
 * Required env vars:
 * - CF_API_TOKEN
 * - CF_ACCOUNT_ID
 * - KV_NAMESPACE_ID
 *
 * Optional:
 * - KV_RESTORE_PREFIX (only restore keys with this prefix)
 */

import fs from 'node:fs';

const token = process.env.CF_API_TOKEN || '';
const accountId = process.env.CF_ACCOUNT_ID || '';
const namespaceId = process.env.KV_NAMESPACE_ID || '';
const keyPrefix = process.env.KV_RESTORE_PREFIX || '';
const backupFile = process.argv[2];

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function cfPut(key, item) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`);
    if (item.expiration) {
        url.searchParams.set('expiration', String(item.expiration));
    } else if (item.expiration_ttl) {
        url.searchParams.set('expiration_ttl', String(item.expiration_ttl));
    }

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: String(item.value ?? '')
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PUT failed for key "${key}" (${res.status}): ${text.slice(0, 300)}`);
    }
}

async function main() {
    if (!token || !accountId || !namespaceId) {
        fail('Missing required env vars. Set CF_API_TOKEN, CF_ACCOUNT_ID, KV_NAMESPACE_ID.');
    }
    if (!backupFile) {
        fail('Usage: node scripts/restore-kv.mjs <backup-file.json>');
    }
    if (!fs.existsSync(backupFile)) {
        fail(`Backup file not found: ${backupFile}`);
    }

    const raw = fs.readFileSync(backupFile, 'utf8');
    const parsed = JSON.parse(raw);
    const items = parsed?.items && typeof parsed.items === 'object' ? parsed.items : null;
    if (!items) {
        fail('Invalid backup file format: missing "items" object.');
    }

    const keys = Object.keys(items).filter(key => (keyPrefix ? key.startsWith(keyPrefix) : true));
    console.log(`Restoring ${keys.length} keys...`);

    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        await cfPut(key, items[key]);
        if ((i + 1) % 100 === 0 || i + 1 === keys.length) {
            console.log(`Restored ${i + 1}/${keys.length} keys...`);
        }
    }

    console.log('KV restore complete.');
}

main().catch(err => fail(`KV restore failed: ${err.message || String(err)}`));

