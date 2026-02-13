#!/usr/bin/env node
/**
 * Backup Cloudflare KV namespace values to a JSON snapshot.
 *
 * Required env vars:
 * - CF_API_TOKEN      (token with KV read access)
 * - CF_ACCOUNT_ID     (Cloudflare account ID)
 * - KV_NAMESPACE_ID   (namespace ID for LOON runtime state)
 *
 * Optional:
 * - KV_BACKUP_PREFIX  (only include keys with this prefix)
 * - KV_BACKUP_LIMIT   (max keys to backup; default unlimited)
 * - KV_BACKUP_OUT     (output file path)
 */

import fs from 'node:fs';
import path from 'node:path';

const token = process.env.CF_API_TOKEN || '';
const accountId = process.env.CF_ACCOUNT_ID || '';
const namespaceId = process.env.KV_NAMESPACE_ID || '';
const prefix = process.env.KV_BACKUP_PREFIX || '';
const maxKeys = Number(process.env.KV_BACKUP_LIMIT || '0');

function fail(message) {
    console.error(message);
    process.exit(1);
}

function isoStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function cfJson(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
        const errors = Array.isArray(data?.errors) ? data.errors.map(e => e.message).join('; ') : '';
        throw new Error(`Cloudflare API error (${res.status}): ${errors || res.statusText}`);
    }
    return data;
}

async function cfText(url) {
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    if (!res.ok) {
        throw new Error(`Cloudflare value fetch failed (${res.status}) for ${url}`);
    }
    return res.text();
}

async function listAllKeys() {
    const keys = [];
    let cursor = '';
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`;

    while (true) {
        const qs = [];
        if (cursor) qs.push(`cursor=${encodeURIComponent(cursor)}`);
        if (prefix) qs.push(`prefix=${encodeURIComponent(prefix)}`);
        const url = qs.length ? `${base}?${qs.join('&')}` : base;
        const data = await cfJson(url);
        const result = Array.isArray(data.result) ? data.result : [];
        keys.push(...result);

        if (maxKeys > 0 && keys.length >= maxKeys) {
            return keys.slice(0, maxKeys);
        }

        const info = data.result_info || {};
        if (!info.cursor) break;
        cursor = info.cursor;
    }

    return keys;
}

async function main() {
    if (!token || !accountId || !namespaceId) {
        fail('Missing required env vars. Set CF_API_TOKEN, CF_ACCOUNT_ID, KV_NAMESPACE_ID.');
    }

    const outputPath = process.env.KV_BACKUP_OUT || path.join('backups', `kv-backup-${isoStamp()}.json`);
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log('Listing KV keys...');
    const keys = await listAllKeys();
    console.log(`Found ${keys.length} keys.`);

    const values = {};
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i].name;
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
        const value = await cfText(url);
        values[key] = {
            value,
            expiration: keys[i].expiration || null,
            expiration_ttl: keys[i].expiration_ttl || null
        };
        if ((i + 1) % 100 === 0 || i + 1 === keys.length) {
            console.log(`Backed up ${i + 1}/${keys.length} keys...`);
        }
    }

    const payload = {
        backupTimestamp: new Date().toISOString(),
        accountId,
        namespaceId,
        keyCount: keys.length,
        prefix: prefix || null,
        items: values
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`KV backup saved: ${outputPath}`);
}

main().catch(err => {
    fail(`KV backup failed: ${err.message || String(err)}`);
});

