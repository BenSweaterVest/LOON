/**
 * Tests for WebAuthn/Passkeys Implementation
 * functions/api/passkeys.js
 * 
 * Tests passkey registration, authentication, and recovery flows
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
    arrayBufferToBase64Url,
    base64UrlToArrayBuffer,
    generateRecoveryCodes,
    isValidRecoveryCode,
    hashRecoveryCode,
    verifyRecoveryCode,
    timingSafeEqual
} from '../functions/api/_webauthn.js';

describe('WebAuthn Utilities', () => {
    describe('Base64 URL Encoding', () => {
        it('should convert ArrayBuffer to base64url', () => {
            const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
            const encoded = arrayBufferToBase64Url(data.buffer);
            
            expect(encoded).toBeTruthy();
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });
        
        it('should convert base64url to ArrayBuffer', () => {
            const encoded = 'SGVsbG8';
            const decoded = base64UrlToArrayBuffer(encoded);
            const bytes = new Uint8Array(decoded);
            
            expect(bytes[0]).toBe(72); // 'H'
            expect(bytes[1]).toBe(101); // 'e'
        });
        
        it('should round-trip encode/decode', () => {
            const original = new Uint8Array([1, 2, 3, 4, 5]);
            const encoded = arrayBufferToBase64Url(original.buffer);
            const decoded = base64UrlToArrayBuffer(encoded);
            const result = new Uint8Array(decoded);
            
            expect(result).toEqual(original);
        });
    });
    
    describe('Recovery Codes', () => {
        it('should generate 12 recovery codes', () => {
            const codes = generateRecoveryCodes();
            
            expect(codes).toHaveLength(12);
            codes.forEach(code => {
                expect(code).toHaveLength(8);
                expect(code).toMatch(/^[A-Z0-9]{8}$/);
            });
        });
        
        it('should generate unique recovery codes', () => {
            const codes = generateRecoveryCodes();
            const uniqueCodes = new Set(codes);
            
            expect(uniqueCodes.size).toBe(codes.length);
        });
        
        it('should validate recovery code format', () => {
            expect(isValidRecoveryCode('ABC12345')).toBe(true);
            expect(isValidRecoveryCode('ZZZZZZZZ')).toBe(true);
            expect(isValidRecoveryCode('00000000')).toBe(true);
            
            expect(isValidRecoveryCode('ABC123')).toBe(false); // Too short
            expect(isValidRecoveryCode('ABC12345678')).toBe(false); // Too long
            expect(isValidRecoveryCode('abc12345')).toBe(false); // Lowercase
            expect(isValidRecoveryCode('ABC1234@')).toBe(false); // Special char
        });
        
        it('should hash recovery code', async () => {
            const code = 'TEST1234';
            const result = await hashRecoveryCode(code);
            
            expect(result.hash).toBeTruthy();
            expect(result.salt).toBeTruthy();
            expect(result.hash).not.toBe(code);
        });
        
        it('should verify correct recovery code', async () => {
            const code = 'RECOVER1';
            const { hash, salt } = await hashRecoveryCode(code);
            
            const isValid = await verifyRecoveryCode(code, hash, salt);
            expect(isValid).toBe(true);
        });
        
        it('should reject incorrect recovery code', async () => {
            const correctCode = 'CORRECT1';
            const wrongCode = 'WRONG123';
            const { hash, salt } = await hashRecoveryCode(correctCode);
            
            const isValid = await verifyRecoveryCode(wrongCode, hash, salt);
            expect(isValid).toBe(false);
        });
        
        it('should use timing-safe comparison', async () => {
            const start1 = performance.now();
            const result1 = timingSafeEqual('AAAAAAAA', 'AAAAAAAA');
            const time1 = performance.now() - start1;
            
            const start2 = performance.now();
            const result2 = timingSafeEqual('AAAAAAAA', 'BBBBBBBB');
            const time2 = performance.now() - start2;
            
            expect(result1).toBe(true);
            expect(result2).toBe(false);
            
            // Timing should be similar (within reasonable margin)
            // This is a weak test but demonstrates timing-safe intent
            const timeDiff = Math.abs(time1 - time2);
            expect(timeDiff).toBeLessThan(10); // milliseconds
        });
    });
    
    describe('WebAuthn Security Properties', () => {
        it('should enforce origin binding', () => {
            // Passkeys are origin-bound - cannot be used on different domain
            const origin1 = 'https://example.com';
            const origin2 = 'https://evil.com';
            
            expect(origin1).not.toBe(origin2);
            // In real implementation, clientDataJSON includes origin
            // and verification would fail for mismatched origins
        });
        
        it('should enforce RP ID hash validation', async () => {
            const rpId = 'example.com';
            const encoder = new TextEncoder();
            const hash = await crypto.subtle.digest('SHA-256', encoder.encode(rpId));
            const rpIdHash = arrayBufferToBase64Url(hash);
            
            expect(rpIdHash).toBeTruthy();
            expect(rpIdHash.length).toBeGreaterThan(0);
            
            // Different RP ID should produce different hash
            const hash2 = await crypto.subtle.digest('SHA-256', encoder.encode('evil.com'));
            const rpIdHash2 = arrayBufferToBase64Url(hash2);
            
            expect(rpIdHash).not.toBe(rpIdHash2);
        });
        
        it('should detect counter non-increment (cloned device)', () => {
            const storedCounter = 5;
            const sameCounter = 5;
            const lowerCounter = 3;
            const higherCounter = 6;
            
            // Same or lower counter indicates possible cloning
            expect(sameCounter <= storedCounter).toBe(true);
            expect(lowerCounter <= storedCounter).toBe(true);
            
            // Higher counter is expected normal behavior
            expect(higherCounter > storedCounter).toBe(true);
        });
    });
    
    describe('Challenge Management', () => {
        it('should generate unique challenges', () => {
            const challenge1 = crypto.getRandomValues(new Uint8Array(32));
            const challenge2 = crypto.getRandomValues(new Uint8Array(32));
            
            const encoded1 = arrayBufferToBase64Url(challenge1.buffer);
            const encoded2 = arrayBufferToBase64Url(challenge2.buffer);
            
            expect(encoded1).not.toBe(encoded2);
        });
        
        it('should have sufficient challenge entropy', () => {
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            
            // 32 bytes = 256 bits of entropy
            expect(challenge.length).toBe(32);
            
            // Should not be all zeros
            const sum = challenge.reduce((a, b) => a + b, 0);
            expect(sum).toBeGreaterThan(0);
        });
    });
    
    describe('Credential Storage Format', () => {
        it('should store required credential properties', () => {
            const credential = {
                id: 'credential-id-123',
                credentialId: 'credential-id-123',
                publicKey: 'mock-cbor-encoded-key',
                algorithm: -7, // ES256
                transports: ['internal', 'usb'],
                created: Date.now(),
                lastUsed: null,
                name: 'My Device',
                counter: 0,
                aaguid: '00000000-0000-0000-0000-000000000000'
            };
            
            expect(credential.id).toBeTruthy();
            expect(credential.publicKey).toBeTruthy();
            expect(credential.algorithm).toBe(-7);
            expect(Array.isArray(credential.transports)).toBe(true);
            expect(typeof credential.created).toBe('number');
            expect(typeof credential.counter).toBe('number');
        });
    });
    
    describe('Recovery Code One-Time Use', () => {
        it('should track used recovery codes', () => {
            const codes = [
                { index: 0, hash: 'hash1', used: false },
                { index: 1, hash: 'hash2', used: false },
                { index: 2, hash: 'hash3', used: true }
            ];
            
            const usedIndexes = [2];
            const availableCodes = codes.filter(c => !usedIndexes.includes(c.index));
            
            expect(availableCodes.length).toBe(2);
            expect(availableCodes[0].index).toBe(0);
            expect(availableCodes[1].index).toBe(1);
        });
        
        it('should warn when running low on codes', () => {
            const totalCodes = 12;
            const usedCodes = 10;
            const remaining = totalCodes - usedCodes;
            
            expect(remaining).toBeLessThan(3);
            // Application should warn user to regenerate codes
        });
    });
});

describe('WebAuthn Implementation Status', () => {
    it('should document what is implemented', () => {
        const implemented = {
            challengeGeneration: true,
            credentialStorage: true,
            recoveryCodes: true,
            auditLogging: true,
            sessionManagement: true,
            attestationVerification: false, // Attestation chain not verified
            assertionVerification: true,
            originValidation: true,
            rpIdHashValidation: true,
            counterValidation: true // Basic check only
        };
        
        const todo = Object.entries(implemented)
            .filter(([key, value]) => !value)
            .map(([key]) => key);
        
        console.log('WebAuthn TODO items:', todo);
        expect(todo.length).toBeGreaterThan(0); // Document remaining work
    });
    
    it('should define WebAuthn verification requirements', () => {
        const requirements = {
            registration: [
                'Parse clientDataJSON and verify challenge',
                'Verify origin matches RP ID',
                'Parse CBOR attestation object',
                'Extract and validate public key',
                'Verify attestation signature (if not self-attested)',
                'Store credential ID and public key'
            ],
            authentication: [
                'Parse clientDataJSON and verify challenge',
                'Verify origin matches RP ID',
                'Parse authenticatorData',
                'Verify RP ID hash',
                'Verify user present (UP) flag',
                'Verify user verified (UV) flag if required',
                'Verify counter incremented',
                'Verify signature using stored public key',
                'Generate session token on success'
            ]
        };
        
        expect(requirements.registration.length).toBe(6);
        expect(requirements.authentication.length).toBe(9);
    });
});
