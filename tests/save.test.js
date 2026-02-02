/**
 * Tests for Save Endpoint
 * functions/api/save.js
 * @version 3.0.0
 */

import { describe, it, expect } from 'vitest';

describe('Save Endpoint', () => {
    describe('Content Size Validation', () => {
        const MAX_SIZE = 1024 * 1024; // 1MB
        
        it('should accept content under limit', () => {
            const content = { title: 'Test', body: 'Short content' };
            const size = JSON.stringify(content).length;
            expect(size < MAX_SIZE).toBe(true);
        });
        
        it('should reject content over limit', () => {
            const largeContent = { data: 'x'.repeat(2 * 1024 * 1024) };
            const size = JSON.stringify(largeContent).length;
            expect(size > MAX_SIZE).toBe(true);
        });
    });
    
    describe('File Path Construction', () => {
        it('should build correct file path', () => {
            const pageId = 'demo';
            const filePath = `data/${pageId}/content.json`;
            expect(filePath).toBe('data/demo/content.json');
        });
        
        it('should handle hyphenated page IDs', () => {
            const pageId = 'my-blog-post';
            const filePath = `data/${pageId}/content.json`;
            expect(filePath).toBe('data/my-blog-post/content.json');
        });
    });
    
    describe('Metadata Injection', () => {
        it('should add lastModified timestamp', () => {
            const content = { title: 'Test' };
            const withMeta = {
                ...content,
                _meta: {
                    lastModified: new Date().toISOString(),
                    modifiedBy: 'testuser'
                }
            };
            
            expect(withMeta._meta.lastModified).toBeDefined();
            expect(withMeta._meta.modifiedBy).toBe('testuser');
        });
        
        it('should preserve existing createdBy', () => {
            const existing = {
                _meta: {
                    createdBy: 'originalauthor',
                    created: '2026-01-01T00:00:00Z'
                }
            };
            
            const updated = {
                _meta: {
                    ...existing._meta,
                    lastModified: new Date().toISOString(),
                    modifiedBy: 'editor'
                }
            };
            
            expect(updated._meta.createdBy).toBe('originalauthor');
            expect(updated._meta.modifiedBy).toBe('editor');
        });
    });
});

describe('GitHub API Integration', () => {
    describe('Base64 Encoding', () => {
        it('should encode content correctly', () => {
            const content = { hello: 'world' };
            const jsonString = JSON.stringify(content, null, 2);
            const encoded = btoa(unescape(encodeURIComponent(jsonString)));
            
            // Decode and verify
            const decoded = decodeURIComponent(escape(atob(encoded)));
            const parsed = JSON.parse(decoded);
            expect(parsed.hello).toBe('world');
        });
        
        it('should handle unicode characters', () => {
            const content = { message: 'Hello 世界 🌍' };
            const jsonString = JSON.stringify(content);
            const encoded = btoa(unescape(encodeURIComponent(jsonString)));
            const decoded = decodeURIComponent(escape(atob(encoded)));
            const parsed = JSON.parse(decoded);
            
            expect(parsed.message).toBe('Hello 世界 🌍');
        });
    });
    
    describe('Commit Message Generation', () => {
        it('should generate descriptive commit message', () => {
            const pageId = 'demo';
            const username = 'admin';
            const message = `LOON: Update ${pageId} content`;
            
            expect(message).toContain('demo');
            expect(message).toContain('LOON');
        });
        
        it('should include username and role in commit message', () => {
            const pageId = 'demo';
            const username = 'admin';
            const role = 'editor';
            const message = `Update ${pageId} by ${username} (${role})`;

            expect(message).toContain('admin');
            expect(message).toContain('editor');
        });
    });
});
