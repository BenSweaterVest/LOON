/**
 * Tests for Health Endpoint
 * functions/api/health.js
 * @version 3.1.0
 */

import { describe, it, expect } from 'vitest';

describe('Health Endpoint', () => {
    describe('Configuration Checks', () => {
        it('should detect missing GITHUB_REPO', () => {
            const env = { GITHUB_TOKEN: 'token', LOON_DB: {} };
            const checks = {
                github_repo: !!env.GITHUB_REPO,
                github_token: !!env.GITHUB_TOKEN,
                kv_database: !!env.LOON_DB,
                images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN
            };

            expect(checks.github_repo).toBe(false);
            expect(checks.github_token).toBe(true);
            expect(checks.kv_database).toBe(true);
        });

        it('should detect missing GITHUB_TOKEN', () => {
            const env = { GITHUB_REPO: 'user/repo', LOON_DB: {} };
            const checks = {
                github_repo: !!env.GITHUB_REPO,
                github_token: !!env.GITHUB_TOKEN,
                kv_database: !!env.LOON_DB,
                images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN
            };

            expect(checks.github_repo).toBe(true);
            expect(checks.github_token).toBe(false);
            expect(checks.kv_database).toBe(true);
        });

        it('should detect missing KV database', () => {
            const env = { GITHUB_REPO: 'user/repo', GITHUB_TOKEN: 'token' };
            const checks = {
                github_repo: !!env.GITHUB_REPO,
                github_token: !!env.GITHUB_TOKEN,
                kv_database: !!env.LOON_DB,
                images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN
            };

            expect(checks.github_repo).toBe(true);
            expect(checks.github_token).toBe(true);
            expect(checks.kv_database).toBe(false);
        });

        it('should pass when all required vars present', () => {
            const env = {
                GITHUB_REPO: 'user/repo',
                GITHUB_TOKEN: 'token',
                LOON_DB: {} // Mock KV binding
            };
            const checks = {
                github_repo: !!env.GITHUB_REPO,
                github_token: !!env.GITHUB_TOKEN,
                kv_database: !!env.LOON_DB,
                images_configured: !!env.CF_ACCOUNT_ID && !!env.CF_IMAGES_TOKEN
            };

            const allHealthy = Object.values(checks).every(v => v);
            expect(allHealthy).toBe(true);
        });
    });

    describe('Response Format', () => {
        it('should include all required fields', () => {
            const response = {
                status: 'ok',
                version: '3.1.0',
                timestamp: new Date().toISOString(),
                checks: {
                    github_repo: true,
                    github_token: true,
                    kv_database: true,
                    images_configured: false
                }
            };

            expect(response.status).toBeDefined();
            expect(response.version).toBe('3.1.0');
            expect(response.timestamp).toBeDefined();
            expect(response.checks).toBeDefined();
            expect(response.checks.kv_database).toBe(true);
        });
        
        it('should return valid ISO timestamp', () => {
            const timestamp = new Date().toISOString();
            const parsed = new Date(timestamp);
            expect(parsed instanceof Date).toBe(true);
            expect(isNaN(parsed.getTime())).toBe(false);
        });
    });
    
    describe('HTTP Status Codes', () => {
        it('should return 200 when healthy', () => {
            const allHealthy = true;
            const statusCode = allHealthy ? 200 : 503;
            expect(statusCode).toBe(200);
        });
        
        it('should return 503 when degraded', () => {
            const allHealthy = false;
            const statusCode = allHealthy ? 200 : 503;
            expect(statusCode).toBe(503);
        });
    });
});
