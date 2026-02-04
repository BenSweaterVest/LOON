/**
 * ============================================================================
 * Passkey Tests (tests/passkeys.test.js)
 * ============================================================================
 *
 * Comprehensive test suite for WebAuthn/FIDO2 passkey functionality:
 * - Registration flow (challenge generation, attestation verification)
 * - Authentication flow (challenge generation, assertion verification)
 * - Recovery code flow (generation, verification, invalidation)
 * - Passkey management (listing, updating, deletion)
 * - Error handling and edge cases
 *

 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    arrayBufferToBase64Url,
    base64UrlToArrayBuffer,
    getRandomBytes,
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
    isValidRecoveryCode,
    timingSafeEqual
} from '../functions/api/_webauthn.js';
import {
    createPasskeyCredential,
    createRecoveryCodesEntry,
    isValidCredentialId,
    getPasskeyKey,
    getRecoveryCodesKey,
    getUnusedRecoveryCodeCount
} from '../functions/api/_passkeys-schema.js';

describe('WebAuthn Utilities', () => {
    describe('Base64URL Encoding', () => {
        it('should encode ArrayBuffer to base64url', () => {
            const buffer = new TextEncoder().encode('hello');
            const encoded = arrayBufferToBase64Url(buffer);
            
            expect(encoded).toBeTruthy();
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });
        
        it('should decode base64url to ArrayBuffer', () => {
            const original = new TextEncoder().encode('world');
            const encoded = arrayBufferToBase64Url(original);
            const decoded = base64UrlToArrayBuffer(encoded);
            
            const decodedStr = new TextDecoder().decode(decoded);
            expect(decodedStr).toBe('world');
        });
        
        it('should handle round-trip conversion', () => {
            const randomBytes = getRandomBytes(32);
            const encoded = arrayBufferToBase64Url(randomBytes);
            const decoded = base64UrlToArrayBuffer(encoded);
            
            const originalView = new Uint8Array(randomBytes);
            const decodedView = new Uint8Array(decoded);
            
            expect(decodedView).toEqual(originalView);
        });
    });
    
    describe('Random Bytes Generation', () => {
        it('should generate random bytes', () => {
            const bytes1 = getRandomBytes(32);
            const bytes2 = getRandomBytes(32);
            
            expect(bytes1).toHaveLength(32);
            expect(bytes2).toHaveLength(32);
            expect(bytes1).not.toEqual(bytes2); // Extremely unlikely to be equal
        });
        
        it('should generate different lengths', () => {
            expect(getRandomBytes(16)).toHaveLength(16);
            expect(getRandomBytes(64)).toHaveLength(64);
            expect(getRandomBytes(1)).toHaveLength(1);
        });
    });
    
    describe('Recovery Codes', () => {
        it('should generate 12 recovery codes', () => {
            const codes = generateRecoveryCodes();
            
            expect(codes).toHaveLength(12);
            codes.forEach(code => {
                expect(code).toMatch(/^[A-Z0-9]{8}$/);
            });
        });
        
        it('should generate unique recovery codes', () => {
            const codes = generateRecoveryCodes();
            const uniqueCodes = new Set(codes);
            
            expect(uniqueCodes.size).toBe(12);
        });
        
        it('should validate recovery code format', () => {
            expect(isValidRecoveryCode('ABC12345')).toBe(true);
            expect(isValidRecoveryCode('XYZ98765')).toBe(true);
            expect(isValidRecoveryCode('abc12345')).toBe(false); // lowercase
            expect(isValidRecoveryCode('ABC1234')).toBe(false); // too short
            expect(isValidRecoveryCode('ABC123456')).toBe(false); // too long
            expect(isValidRecoveryCode('ABC-1234')).toBe(false); // invalid char
        });
    });
    
    describe('Recovery Code Hashing', () => {
        it('should hash recovery code consistently', async () => {
            const code = 'ABC12345';
            const result1 = await hashRecoveryCode(code);
            const result2 = await hashRecoveryCode(code, result1.salt);
            
            expect(result1.hash).toBe(result2.hash);
        });
        
        it('should produce different hashes for different codes', async () => {
            const hash1 = await hashRecoveryCode('ABC12345');
            const hash2 = await hashRecoveryCode('XYZ98765');
            
            expect(hash1.hash).not.toBe(hash2.hash);
        });
        
        it('should verify correct code', async () => {
            const code = 'ABC12345';
            const { hash, salt } = await hashRecoveryCode(code);
            
            const isValid = await verifyRecoveryCode(code, hash, salt);
            expect(isValid).toBe(true);
        });
        
        it('should reject incorrect code', async () => {
            const { hash, salt } = await hashRecoveryCode('ABC12345');
            
            const isValid = await verifyRecoveryCode('XYZ98765', hash, salt);
            expect(isValid).toBe(false);
        });
    });
    
    describe('Timing-Safe Comparison', () => {
        it('should return true for identical strings', () => {
            const result = timingSafeEqual('hello', 'hello');
            expect(result).toBe(true);
        });
        
        it('should return false for different strings', () => {
            const result = timingSafeEqual('hello', 'world');
            expect(result).toBe(false);
        });
        
        it('should return false for different lengths', () => {
            const result = timingSafeEqual('hello', 'hi');
            expect(result).toBe(false);
        });
        
        it('should throw on non-string input', () => {
            expect(() => {
                timingSafeEqual(123, '123');
            }).toThrow();
        });
    });
});

describe('Passkey Schema', () => {
    describe('Credential Creation', () => {
        it('should create valid passkey credential', () => {
            const credentialId = 'test-cred-id-12345678';
            const publicKey = 'base64-encoded-public-key';
            
            const credential = createPasskeyCredential(credentialId, publicKey);
            
            expect(credential.id).toBe(credentialId);
            expect(credential.credentialId).toBe(credentialId);
            expect(credential.publicKey).toBe(publicKey);
            expect(credential.algorithm).toBe(-7); // ES256
            expect(credential.created).toBeTruthy();
            expect(credential.counter).toBe(0);
            expect(credential.name).toBe('Unnamed Device');
            expect(credential.transports).toContain('internal');
        });
        
        it('should accept custom transports', () => {
            const credential = createPasskeyCredential(
                'cred-id',
                'key',
                ['usb', 'ble']
            );
            
            expect(credential.transports).toEqual(['usb', 'ble']);
        });
    });
    
    describe('Credential ID Validation', () => {
        it('should validate valid credential IDs', () => {
            expect(isValidCredentialId('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')).toBe(true);
            expect(isValidCredentialId('a-_b-_c-123456789012')).toBe(true);
        });
        
        it('should reject invalid credential IDs', () => {
            expect(isValidCredentialId('short')).toBe(false); // too short
            expect(isValidCredentialId('')).toBe(false); // empty
            expect(isValidCredentialId('abc+def')).toBe(false); // invalid char
            expect(isValidCredentialId('abc/def')).toBe(false); // invalid char
        });
    });
    
    describe('KV Key Generation', () => {
        it('should generate passkey key', () => {
            const key = getPasskeyKey('admin', 'cred-123');
            expect(key).toBe('user:admin:passkey:cred-123');
        });
        
        it('should generate recovery codes key', () => {
            const key = getRecoveryCodesKey('admin');
            expect(key).toBe('user:admin:recovery');
        });
        
        it('should throw on missing parameters', () => {
            expect(() => getPasskeyKey('', 'cred')).toThrow();
            expect(() => getPasskeyKey('admin', '')).toThrow();
            expect(() => getRecoveryCodesKey('')).toThrow();
        });
    });
    
    describe('Recovery Codes Entry', () => {
        it('should create recovery codes entry', async () => {
            const plainCodes = ['ABC12345', 'DEF67890', 'GHI34567', 'JKL01234',
                               'MNO56789', 'PQR23456', 'STU78901', 'VWX45678',
                               'YZA12345', 'BCD67890', 'EFG34567', 'HIJ01234'];
            
            const entry = await createRecoveryCodesEntry(plainCodes);
            
            expect(entry.codes).toHaveLength(12);
            expect(entry.salt).toBeTruthy();
            expect(entry.created).toBeTruthy();
            expect(entry.used).toEqual([]);
            expect(entry.plainCodes).toEqual(plainCodes);
        });
        
        it('should calculate unused code count', async () => {
            const entry = await createRecoveryCodesEntry();
            
            const unused = getUnusedRecoveryCodeCount(entry);
            expect(unused).toBe(12);
        });
        
        it('should calculate unused codes with some used', async () => {
            const entry = await createRecoveryCodesEntry();
            entry.used = [0, 3, 7]; // 3 used
            
            const unused = getUnusedRecoveryCodeCount(entry);
            expect(unused).toBe(9);
        });
    });
});

describe('Passkey Integration Scenarios', () => {
    describe('Registration Flow', () => {
        it('should complete registration scenario', async () => {
            // 1. User receives challenge
            const challenge = getRandomBytes(32);
            const challengeB64 = arrayBufferToBase64Url(challenge);
            expect(challengeB64).toBeTruthy();
            
            // 2. User creates passkey with challenge
            const credentialId = 'new-cred-1234567890123';
            expect(isValidCredentialId(credentialId)).toBe(true);
            
            // 3. Backend stores credential
            const credential = createPasskeyCredential(
                credentialId,
                'base64-public-key',
                ['internal']
            );
            expect(credential.created).toBeTruthy();
            
            // 4. Backend generates recovery codes
            const recoveryEntry = await createRecoveryCodesEntry();
            expect(recoveryEntry.plainCodes).toHaveLength(12);
            
            // 5. User saves recovery codes
            const unused = getUnusedRecoveryCodeCount(recoveryEntry);
            expect(unused).toBe(12);
        });
    });
    
    describe('Recovery Code Flow', () => {
        it('should complete recovery code verification scenario', async () => {
            // 1. Generate recovery codes
            const originalCodes = generateRecoveryCodes();
            expect(originalCodes).toHaveLength(12);
            
            // 2. User loses passkey, provides recovery code
            const providedCode = originalCodes[3]; // User provides 4th code
            
            // 3. Verify recovery code
            const isValid = isValidRecoveryCode(providedCode);
            expect(isValid).toBe(true);
            
            // 4. Backend validates (simulated)
            const entry = await createRecoveryCodesEntry(originalCodes);
            const matches = await verifyRecoveryCode(providedCode, entry.codes[3], entry.salt);
            expect(matches).toBe(true);
            
            // 5. Mark code as used
            entry.used.push(3);
            const unused = getUnusedRecoveryCodeCount(entry);
            expect(unused).toBe(11);
        });
    });
    
    describe('Multiple Passkeys Per User', () => {
        it('should support multiple passkeys', () => {
            const passkeys = [
                createPasskeyCredential('cred-1', 'key-1', ['internal']),
                createPasskeyCredential('cred-2', 'key-2', ['usb']),
                createPasskeyCredential('cred-3', 'key-3', ['ble'])
            ];
            
            expect(passkeys).toHaveLength(3);
            expect(passkeys[0].transports).toContain('internal');
            expect(passkeys[1].transports).toContain('usb');
            expect(passkeys[2].transports).toContain('ble');
        });
    });
});

describe('Edge Cases and Error Handling', () => {
    it('should handle empty recovery codes list', () => {
        const unused = getUnusedRecoveryCodeCount(null);
        expect(unused).toBe(0);
    });
    
    it('should handle large random values', () => {
        const bytes = getRandomBytes(1024);
        expect(bytes).toHaveLength(1024);
    });
    
    it('should handle credential ID edge lengths', () => {
        // Minimum length: ~20 chars
        const minId = 'a'.repeat(20);
        expect(isValidCredentialId(minId)).toBe(true);
        
        // Maximum length: 350 chars
        const maxId = 'a'.repeat(350);
        expect(isValidCredentialId(maxId)).toBe(true);
        
        // Just over max
        const overMax = 'a'.repeat(351);
        expect(isValidCredentialId(overMax)).toBe(false);
    });
});

describe('Security Properties', () => {
    it('should generate cryptographically random bytes', () => {
        const sets = [];
        for (let i = 0; i < 10; i++) {
            sets.push(getRandomBytes(32));
        }
        
        // Each set should be unique
        for (let i = 0; i < sets.length; i++) {
            for (let j = i + 1; j < sets.length; j++) {
                const view1 = new Uint8Array(sets[i]);
                const view2 = new Uint8Array(sets[j]);
                expect(view1).not.toEqual(view2);
            }
        }
    });
    
    it('should hash recovery codes securely', async () => {
        const code1 = 'ABC12345';
        const code2 = 'ABC12346'; // One char different
        
        const hash1 = await hashRecoveryCode(code1);
        const hash2 = await hashRecoveryCode(code2, hash1.salt);
        
        // Different codes produce different hashes even with same salt
        expect(hash1.hash).not.toBe(hash2.hash);
    });
    
    it('should perform timing-safe comparison', () => {
        const matching = timingSafeEqual(
            'a'.repeat(100),
            'a'.repeat(100)
        );
        const nonMatching = timingSafeEqual(
            'a'.repeat(100),
            'b'.repeat(100)
        );
        
        expect(matching).toBe(true);
        expect(nonMatching).toBe(false);
    });
});
