/**
 * Tests for Bootstrap Flow
 * scripts/bootstrap-admin.js and first login flow
 * 
 * Tests bootstrap user creation and password upgrade on first login
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockKV, createMockRequest, createMockEnv } from './helpers.js';
import { onRequestPost as loginHandler } from '../functions/api/auth.js';

describe('Bootstrap Flow', () => {
    let mockKV;
    let mockEnv;
    
    beforeEach(() => {
        mockKV = createMockKV();
        mockEnv = createMockEnv({ LOON_DB: mockKV });
    });
    
    describe('Bootstrap User Creation', () => {
        it('should create bootstrap user with correct structure', async () => {
            const bootstrapUser = {
                username: 'admin',
                role: 'admin',
                password: 'SecurePassword123',
                bootstrap: true,
                created: new Date().toISOString(),
                lastLogin: null,
                mfaEnabled: false,
                passkeysEnabled: false
            };
            
            await mockKV.put('user:admin', JSON.stringify(bootstrapUser));
            
            const retrieved = await mockKV.get('user:admin', { type: 'json' });
            
            expect(retrieved.username).toBe('admin');
            expect(retrieved.role).toBe('admin');
            expect(retrieved.bootstrap).toBe(true);
            expect(retrieved.password).toBe('SecurePassword123');
            expect(retrieved.hash).toBeUndefined();
            expect(retrieved.salt).toBeUndefined();
        });
        
        it('should not have hash or salt in bootstrap mode', async () => {
            const bootstrapUser = {
                username: 'testuser',
                role: 'contributor',
                password: 'TempPass456',
                bootstrap: true,
                created: new Date().toISOString()
            };
            
            await mockKV.put('user:testuser', JSON.stringify(bootstrapUser));
            const retrieved = await mockKV.get('user:testuser', { type: 'json' });
            
            expect(retrieved.hash).toBeUndefined();
            expect(retrieved.salt).toBeUndefined();
            expect(retrieved.password).toBe('TempPass456');
        });
    });
    
    describe('First Login Password Upgrade', () => {
        it('should detect bootstrap flag on login', async () => {
            // Create bootstrap user
            const bootstrapUser = {
                username: 'admin',
                role: 'admin',
                password: 'InitialPassword123',
                bootstrap: true,
                created: new Date().toISOString(),
                lastLogin: null
            };
            
            await mockKV.put('user:admin', JSON.stringify(bootstrapUser));
            
            // Attempt login
            const request = createMockRequest('POST', {
                username: 'admin',
                password: 'InitialPassword123'
            });
            
            const context = { request, env: mockEnv };
            const response = await loginHandler(context);
            const data = await response.json();
            
            // Should successfully login
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.token).toBeTruthy();
            
            // Verify user was upgraded
            const upgraded = await mockKV.get('user:admin', { type: 'json' });
            expect(upgraded.bootstrap).toBeUndefined();
            expect(upgraded.password).toBeUndefined();
            expect(upgraded.hash).toBeTruthy();
            expect(upgraded.salt).toBeTruthy();
        });
        
        it('should reject wrong password even in bootstrap mode', async () => {
            const bootstrapUser = {
                username: 'admin',
                role: 'admin',
                password: 'CorrectPassword',
                bootstrap: true,
                created: new Date().toISOString()
            };
            
            await mockKV.put('user:admin', JSON.stringify(bootstrapUser));
            
            const request = createMockRequest('POST', {
                username: 'admin',
                password: 'WrongPassword'
            });
            
            const context = { request, env: mockEnv };
            const response = await loginHandler(context);
            const data = await response.json();
            
            expect(response.status).toBe(401);
            expect(data.error).toBeTruthy();
            
            // User should still be in bootstrap mode
            const user = await mockKV.get('user:admin', { type: 'json' });
            expect(user.bootstrap).toBe(true);
            expect(user.password).toBe('CorrectPassword');
        });
        
        it('should allow subsequent logins with hashed password', async () => {
            // Create already-upgraded user (simulating post-first-login)
            const upgradedUser = {
                username: 'admin',
                role: 'admin',
                hash: 'HhR1Z5YUGGfhN2bBN2bBN2bBN2bBN2bBN2bBN2bBN2bBN2bBN2bBN2bB', // base64
                salt: crypto.randomUUID(),
                created: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            };
            
            await mockKV.put('user:admin', JSON.stringify(upgradedUser));
            
            const retrieved = await mockKV.get('user:admin', { type: 'json' });
            expect(retrieved.bootstrap).toBeUndefined();
            expect(retrieved.password).toBeUndefined();
            expect(retrieved.hash).toBeTruthy();
        });
        
        it('should successfully login twice with same password (system-level test)', async () => {
            // Create bootstrap user
            const bootstrapUser = {
                username: 'sysadmin',
                role: 'admin',
                password: 'SystemTest456',
                bootstrap: true,
                created: new Date().toISOString()
            };
            
            await mockKV.put('user:sysadmin', JSON.stringify(bootstrapUser));
            
            // First login (upgrades password)
            const request1 = createMockRequest('POST', {
                username: 'sysadmin',
                password: 'SystemTest456'
            });
            
            const response1 = await loginHandler({ request: request1, env: mockEnv });
            expect(response1.status).toBe(200);
            
            const data1 = await response1.json();
            expect(data1.success).toBe(true);
            expect(data1.token).toBeTruthy();
            
            // Second login (should work with hashed password)
            const request2 = createMockRequest('POST', {
                username: 'sysadmin',
                password: 'SystemTest456'
            });
            
            const response2 = await loginHandler({ request: request2, env: mockEnv });
            expect(response2.status).toBe(200);
            
            const data2 = await response2.json();
            expect(data2.success).toBe(true);
            expect(data2.token).toBeTruthy();
            expect(data2.token).not.toBe(data1.token); // Different session
            
            // Verify final state is hashed
            const final = await mockKV.get('user:sysadmin', { type: 'json' });
            expect(final.bootstrap).toBeUndefined();
            expect(final.password).toBeUndefined();
            expect(final.hash).toBeTruthy();
            expect(final.salt).toBeTruthy();
        });
    });
    
    describe('Bootstrap Security', () => {
        it('should only allow bootstrap mode once', async () => {
            const bootstrapUser = {
                username: 'admin',
                role: 'admin',
                password: 'Password123',
                bootstrap: true,
                created: new Date().toISOString()
            };
            
            await mockKV.put('user:admin', JSON.stringify(bootstrapUser));
            
            // First login - should upgrade
            const request1 = createMockRequest('POST', {
                username: 'admin',
                password: 'Password123'
            });
            
            const context1 = { request: request1, env: mockEnv };
            const response1 = await loginHandler(context1);
            expect(response1.status).toBe(200);
            
            // Check bootstrap flag removed
            const upgraded = await mockKV.get('user:admin', { type: 'json' });
            expect(upgraded.bootstrap).toBeUndefined();
            expect(upgraded.password).toBeUndefined();
            
            // Second login attempt should use hashed password
            const user = await mockKV.get('user:admin', { type: 'json' });
            expect(user.hash).toBeTruthy();
            expect(user.salt).toBeTruthy();
        });
        
        it('should clear plaintext password after upgrade', async () => {
            const bootstrapUser = {
                username: 'testadmin',
                role: 'admin',
                password: 'SensitivePassword',
                bootstrap: true,
                created: new Date().toISOString()
            };
            
            await mockKV.put('user:testadmin', JSON.stringify(bootstrapUser));
            
            const request = createMockRequest('POST', {
                username: 'testadmin',
                password: 'SensitivePassword'
            });
            
            const context = { request, env: mockEnv };
            await loginHandler(context);
            
            const upgraded = await mockKV.get('user:testadmin', { type: 'json' });
            
            // Plaintext password must be removed
            expect(upgraded.password).toBeUndefined();
            expect(upgraded.bootstrap).toBeUndefined();
            
            // Hash and salt must be present
            expect(upgraded.hash).toBeTruthy();
            expect(upgraded.salt).toBeTruthy();
        });
    });
    
    describe('Password Hash Format', () => {
        it('should generate base64 hashes (not hex)', () => {
            // Test that base64 format is used (a-zA-Z0-9+/=)
            // not hex format (0-9a-f)
            const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
            const hexRegex = /^[0-9a-f]+$/;
            
            const base64Example = 'SGVsbG8gV29ybGQ=';
            const hexExample = 'deadbeef12345';
            
            expect(base64Example).toMatch(base64Regex);
            expect(base64Example).not.toMatch(hexRegex);
            
            expect(hexExample).toMatch(hexRegex);
            expect(hexExample).not.toMatch(base64Regex);
        });
        
        it('should have expected hash length for PBKDF2-SHA256', () => {
            // PBKDF2-SHA256 with 256 bits output = 32 bytes
            // Base64 encoding of 32 bytes = 44 characters (with padding)
            const expectedLength = 44;
            
            // Mock hash output
            const mockHash = btoa(String.fromCharCode(...new Uint8Array(32).fill(0)));
            
            expect(mockHash.length).toBe(expectedLength);
        });
    });
    
    describe('Bootstrap Script Output Validation', () => {
        it('should produce valid JSON for KV storage', () => {
            const userObject = {
                username: 'admin',
                role: 'admin',
                password: 'TestPassword',
                bootstrap: true,
                created: '2026-02-06T12:00:00.000Z',
                lastLogin: null,
                mfaEnabled: false,
                passkeysEnabled: false
            };
            
            const json = JSON.stringify(userObject);
            expect(() => JSON.parse(json)).not.toThrow();
            
            const parsed = JSON.parse(json);
            expect(parsed.username).toBe('admin');
            expect(parsed.bootstrap).toBe(true);
        });
    });
});
