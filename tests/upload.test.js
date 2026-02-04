/**
 * Tests for Upload Endpoint
 * functions/api/upload.js

 */

import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../functions/api/upload.js';
import { createMockKV } from './helpers.js';

function createRequestWithFormData(formData, token = 'test-token') {
    return {
        method: 'POST',
        headers: new Headers({
            'Authorization': `Bearer ${token}`,
            'CF-Connecting-IP': '127.0.0.1'
        }),
        formData: async () => formData
    };
}

function createFormDataWithFile(file) {
    return {
        get: (key) => (key === 'file' ? file : null)
    };
}

describe('Upload Endpoint', () => {
    let env;
    let db;

    beforeEach(() => {
        db = createMockKV();
        env = {
            LOON_DB: db,
            CF_ACCOUNT_ID: 'account',
            CF_IMAGES_TOKEN: 'token'
        };
    });

    it('should return 503 when Images is not configured', async () => {
        const request = createRequestWithFormData(createFormDataWithFile(null));
        const response = await onRequestPost({ request, env: { LOON_DB: db } });
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.error).toContain('not configured');
    });

    it('should return 401 when auth is missing', async () => {
        const request = {
            method: 'POST',
            headers: new Headers({ 'CF-Connecting-IP': '127.0.0.1' }),
            formData: async () => createFormDataWithFile(null)
        };

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toContain('authorization');
    });

    it('should return 400 when no file provided', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));
        const request = createRequestWithFormData(createFormDataWithFile(null));

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('No file');
    });

    it('should reject invalid file types', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const request = createRequestWithFormData(
            createFormDataWithFile({ size: 10, type: 'text/plain', name: 'file.txt' })
        );

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('Invalid file type');
    });

    it('should reject files larger than 10MB', async () => {
        await db.put('session:test-token', JSON.stringify({ username: 'admin', role: 'admin' }));

        const request = createRequestWithFormData(
            createFormDataWithFile({ size: 10 * 1024 * 1024 + 1, type: 'image/png', name: 'big.png' })
        );

        const response = await onRequestPost({ request, env });
        const data = await response.json();

        expect(response.status).toBe(413);
        expect(data.error).toContain('File too large');
    });
});
