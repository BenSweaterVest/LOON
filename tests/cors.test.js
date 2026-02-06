/**
 * Tests for CORS Behavior
 * functions/api/_cors.js
 * 
 * Tests CORS_ORIGIN environment variable handling and CORS header generation
 */

import { describe, it, expect } from 'vitest';
import { getCorsHeaders, handleCorsOptions, getAllowedOrigin } from '../functions/api/_cors.js';

describe('CORS Utilities', () => {
    describe('getAllowedOrigin', () => {
        it('should return wildcard when CORS_ORIGIN not set', () => {
            const env = {};
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'http://example.com' }
            });
            
            const origin = getAllowedOrigin(env, request);
            expect(origin).toBe('*');
        });
        
        it('should return wildcard when CORS_ORIGIN is *', () => {
            const env = { CORS_ORIGIN: '*' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'http://example.com' }
            });
            
            const origin = getAllowedOrigin(env, request);
            expect(origin).toBe('*');
        });
        
        it('should return request origin when it matches configured origin', () => {
            const env = { CORS_ORIGIN: 'https://example.com' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'https://example.com' }
            });
            
            const origin = getAllowedOrigin(env, request);
            expect(origin).toBe('https://example.com');
        });
        
        it('should return configured origin when request origin does not match', () => {
            const env = { CORS_ORIGIN: 'https://example.com' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'https://evil.com' }
            });
            
            const origin = getAllowedOrigin(env, request);
            expect(origin).toBe('https://example.com');
        });
        
        it('should handle requests without Origin header', () => {
            const env = { CORS_ORIGIN: 'https://example.com' };
            const request = new Request('http://localhost');
            
            const origin = getAllowedOrigin(env, request);
            expect(origin).toBe('https://example.com');
        });
    });
    
    describe('getCorsHeaders', () => {
        it('should generate default CORS headers', () => {
            const env = {};
            const request = new Request('http://localhost');
            
            const headers = getCorsHeaders(env, request);
            
            expect(headers['Access-Control-Allow-Origin']).toBe('*');
            expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
            expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
            expect(headers['Content-Type']).toBe('application/json');
        });
        
        it('should respect custom methods option', () => {
            const env = {};
            const request = new Request('http://localhost');
            const options = { methods: 'GET, POST, DELETE, PATCH' };
            
            const headers = getCorsHeaders(env, request, options);
            
            expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, DELETE, PATCH');
        });
        
        it('should respect custom headers option', () => {
            const env = {};
            const request = new Request('http://localhost');
            const options = { headers: 'Content-Type, X-Custom-Header' };
            
            const headers = getCorsHeaders(env, request, options);
            
            expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Custom-Header');
        });
        
        it('should use configured CORS_ORIGIN when set', () => {
            const env = { CORS_ORIGIN: 'https://trusted.com' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'https://trusted.com' }
            });
            
            const headers = getCorsHeaders(env, request);
            
            expect(headers['Access-Control-Allow-Origin']).toBe('https://trusted.com');
        });
    });
    
    describe('handleCorsOptions', () => {
        it('should return 204 No Content', () => {
            const env = {};
            const request = new Request('http://localhost', { method: 'OPTIONS' });
            
            const response = handleCorsOptions(env, request);
            
            expect(response.status).toBe(204);
        });
        
        it('should include CORS headers in response', () => {
            const env = { CORS_ORIGIN: 'https://example.com' };
            const request = new Request('http://localhost', {
                method: 'OPTIONS',
                headers: { 'Origin': 'https://example.com' }
            });
            
            const response = handleCorsOptions(env, request);
            
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
            expect(response.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
        });
        
        it('should respect custom options', () => {
            const env = {};
            const request = new Request('http://localhost', { method: 'OPTIONS' });
            const options = { methods: 'GET, POST, PATCH' };
            
            const response = handleCorsOptions(env, request, options);
            
            expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH');
        });
    });
    
    describe('CORS Security Scenarios', () => {
        it('should block different origin when CORS_ORIGIN is restrictive', () => {
            const env = { CORS_ORIGIN: 'https://trusted.com' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'https://attacker.com' }
            });
            
            const headers = getCorsHeaders(env, request);
            
            // Browser will block because returned origin doesn't match request origin
            expect(headers['Access-Control-Allow-Origin']).toBe('https://trusted.com');
            expect(headers['Access-Control-Allow-Origin']).not.toBe('https://attacker.com');
        });
        
        it('should allow wildcard for public APIs', () => {
            const env = { CORS_ORIGIN: '*' };
            const request = new Request('http://localhost', {
                headers: { 'Origin': 'https://any-domain.com' }
            });
            
            const headers = getCorsHeaders(env, request);
            
            expect(headers['Access-Control-Allow-Origin']).toBe('*');
        });
    });
});
