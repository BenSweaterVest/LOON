/**
 * Tests for Schema Validation
 * Validates all example schemas
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

describe('Schema Validation', () => {
    const examplesDir = 'examples';
    const dataDir = 'data';
    
    // Get all example directories
    const examples = readdirSync(examplesDir).filter(name => {
        const path = join(examplesDir, name);
        return existsSync(join(path, 'schema.json'));
    });
    
    describe('Example Schemas', () => {
        examples.forEach(example => {
            describe(`examples/${example}`, () => {
                const schemaPath = join(examplesDir, example, 'schema.json');
                const contentPath = join(examplesDir, example, 'content.json');
                
                it('should have valid schema.json', () => {
                    const content = readFileSync(schemaPath, 'utf8');
                    const schema = JSON.parse(content);
                    
                    expect(schema.title).toBeDefined();
                    expect(schema.fields).toBeInstanceOf(Array);
                    expect(schema.fields.length).toBeGreaterThan(0);
                });
                
                it('should have required field properties', () => {
                    const content = readFileSync(schemaPath, 'utf8');
                    const schema = JSON.parse(content);
                    
                    schema.fields.forEach((field, index) => {
                        expect(field.key, `Field ${index} missing key`).toBeDefined();
                        expect(field.label, `Field ${index} missing label`).toBeDefined();
                        expect(field.type, `Field ${index} missing type`).toBeDefined();
                    });
                });
                
                it('should use valid field types', () => {
                    const validTypes = [
                        'text', 'textarea', 'select', 'email', 'url',
                        'number', 'tel', 'date', 'time', 'datetime',
                        'checkbox', 'hidden', 'image'
                    ];
                    
                    const content = readFileSync(schemaPath, 'utf8');
                    const schema = JSON.parse(content);
                    
                    schema.fields.forEach(field => {
                        expect(
                            validTypes.includes(field.type),
                            `Invalid type "${field.type}" in field "${field.key}"`
                        ).toBe(true);
                    });
                });
                
                it('should have select options for select fields', () => {
                    const content = readFileSync(schemaPath, 'utf8');
                    const schema = JSON.parse(content);
                    
                    schema.fields
                        .filter(f => f.type === 'select')
                        .forEach(field => {
                            expect(
                                field.options,
                                `Select field "${field.key}" missing options`
                            ).toBeInstanceOf(Array);
                            expect(
                                field.options.length,
                                `Select field "${field.key}" has no options`
                            ).toBeGreaterThan(0);
                        });
                });
                
                if (existsSync(contentPath)) {
                    it('should have valid content.json', () => {
                        const content = readFileSync(contentPath, 'utf8');
                        const data = JSON.parse(content);
                        expect(data).toBeDefined();
                    });
                }
            });
        });
    });
    
    describe('Demo Schema', () => {
        const schemaPath = join(dataDir, 'demo', 'schema.json');
        const contentPath = join(dataDir, 'demo', 'content.json');
        
        it('should exist', () => {
            expect(existsSync(schemaPath)).toBe(true);
            expect(existsSync(contentPath)).toBe(true);
        });
        
        it('should have valid schema', () => {
            const content = readFileSync(schemaPath, 'utf8');
            const schema = JSON.parse(content);
            
            expect(schema.title).toBe('LOON Demo Page');
            expect(schema.fields.length).toBeGreaterThan(0);
        });
        
        it('should have content matching schema fields', () => {
            const schemaContent = readFileSync(schemaPath, 'utf8');
            const schema = JSON.parse(schemaContent);
            
            const dataContent = readFileSync(contentPath, 'utf8');
            const data = JSON.parse(dataContent);
            
            schema.fields.forEach(field => {
                // Content should have values for schema fields (or be optional)
                if (field.required) {
                    expect(
                        data[field.key],
                        `Required field "${field.key}" missing from content`
                    ).toBeDefined();
                }
            });
        });
    });
});
