import { describe, it, expect, vi } from 'vitest';
import { onRequestPost, onRequestOptions } from '../functions/api/feedback.js';
import { createMockRequest, createMockContext, parseResponse, createMockEnv } from './helpers.js';

describe('Feedback Endpoint', () => {
    it('should handle CORS preflight', async () => {
        const request = new Request('http://localhost/api/feedback', { method: 'OPTIONS' });
        const context = createMockContext(request, createMockEnv());
        const response = await onRequestOptions(context);
        expect(response.status).toBe(204);
    });

    it('should reject invalid pageId format', async () => {
        const request = createMockRequest('POST', { pageId: 'bad id!', message: 'hello' });
        const context = createMockContext(request, createMockEnv());
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid pageId format');
    });

    it('should reject empty message', async () => {
        const request = createMockRequest('POST', { pageId: 'demo', message: '   ' });
        const context = createMockContext(request, createMockEnv());
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid or missing message');
    });

    it('should reject invalid email format', async () => {
        const request = createMockRequest('POST', { pageId: 'demo', message: 'test', email: 'bad-email' });
        const context = createMockContext(request, createMockEnv());
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(400);
        expect(body.error).toContain('Invalid email format');
    });

    it('should accept feedback without KV configured', async () => {
        const env = createMockEnv({ LOON_DB: undefined, KV: undefined });
        const request = createMockRequest('POST', { pageId: 'demo', message: 'helpful note' });
        const context = createMockContext(request, env);
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.id).toBe(null);
    });

    it('should store feedback in KV when configured', async () => {
        const put = vi.fn(async () => {});
        const get = vi.fn(async () => null);
        const env = createMockEnv({
            LOON_DB: {
                get,
                put
            }
        });
        const request = createMockRequest('POST', {
            pageId: 'demo',
            email: 'person@example.com',
            message: 'Looks good',
            timestamp: 'not-a-date'
        }, {
            'CF-Connecting-IP': '10.0.0.1'
        });
        const context = createMockContext(request, env);
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(typeof body.id).toBe('string');
        expect(body.id.startsWith('feedback_')).toBe(true);
        expect(put).toHaveBeenCalledTimes(2);
        const storedEntry = JSON.parse(put.mock.calls[1][1]);
        expect(storedEntry.pageId).toBe('demo');
        expect(storedEntry.message).toBe('Looks good');
        expect(storedEntry.email).toBe('person@example.com');
        expect(storedEntry.ip).toBe('10.0.0.1');
        expect(new Date(storedEntry.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('should rate-limit excessive submissions', async () => {
        const now = Date.now();
        const priorAttempts = Array.from({ length: 10 }, () => now);
        const env = createMockEnv({
            LOON_DB: {
                get: vi.fn(async (key) => key.startsWith('ratelimit:feedback:') ? JSON.stringify(priorAttempts) : null),
                put: vi.fn(async () => {})
            }
        });
        const request = createMockRequest('POST', { pageId: 'demo', message: 'spam' });
        const context = createMockContext(request, env);
        const response = await onRequestPost(context);
        const body = await parseResponse(response);

        expect(response.status).toBe(429);
        expect(body.error).toContain('Too many feedback submissions');
    });
});
