import { describe, it, expect } from 'vitest';
import { getKVBinding, getKVNamespaceId, isKVHealthy } from '../functions/api/_kv.js';
import { createMockKV } from './helpers.js';

describe('KV Utility', () => {
    it('getKVBinding should return null for missing env', () => {
        expect(getKVBinding()).toBeNull();
    });

    it('getKVBinding should prefer LOON_DB then KV fallback', () => {
        const db1 = {};
        const db2 = {};

        expect(getKVBinding({ LOON_DB: db1, KV: db2 })).toBe(db1);
        expect(getKVBinding({ KV: db2 })).toBe(db2);
    });

    it('getKVBinding should support custom KV_NAMESPACE binding name', () => {
        const custom = {};
        const env = { KV_NAMESPACE: 'CUSTOM_DB', CUSTOM_DB: custom };

        expect(getKVBinding(env)).toBe(custom);
    });

    it('isKVHealthy should return true for working KV namespace', async () => {
        const db = createMockKV();
        const healthy = await isKVHealthy(db);
        expect(healthy).toBe(true);
    });

    it('getKVNamespaceId should return configured id', () => {
        expect(getKVNamespaceId({ KV_NAMESPACE_ID: 'abc123' })).toBe('abc123');
        expect(getKVNamespaceId({})).toBeNull();
    });
});
