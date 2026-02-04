/**
 * ============================================================================
 * JSON Schema Validation Utility
 * ============================================================================
 *
 * Validates content against JSON Schema standard and converts legacy LOON
 * schemas to JSON Schema format.
 *
 * @module lib/schema-validator
 */

/**
 * Convert legacy LOON schema to JSON Schema
 */
export function convertToJsonSchema(loonSchema) {
    const properties = {};
    const required = [];
    
    // Convert each field
    for (const field of loonSchema.fields || []) {
        const jsonSchemaField = convertField(field);
        properties[field.key] = jsonSchemaField;
        
        if (field.required) {
            required.push(field.key);
        }
    }
    
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: loonSchema.title || 'Untitled Schema',
        description: loonSchema.description || '',
        type: 'object',
        properties,
        ...(required.length > 0 && { required })
    };
}

/**
 * Convert individual LOON field to JSON Schema property
 */
function convertField(field) {
    const baseSchema = {
        title: field.label || field.key,
        ...(field.placeholder && { description: field.placeholder })
    };
    
    switch (field.type) {
        case 'text':
            return {
                ...baseSchema,
                type: 'string',
                ...(field.minLength && { minLength: field.minLength }),
                ...(field.maxLength && { maxLength: field.maxLength }),
                ...(field.pattern && { pattern: field.pattern })
            };
            
        case 'textarea':
            return {
                ...baseSchema,
                type: 'string',
                ...(field.minLength && { minLength: field.minLength }),
                ...(field.maxLength && { maxLength: field.maxLength })
            };
            
        case 'email':
            return {
                ...baseSchema,
                type: 'string',
                format: 'email'
            };
            
        case 'url':
            return {
                ...baseSchema,
                type: 'string',
                format: 'uri'
            };
            
        case 'number':
            return {
                ...baseSchema,
                type: 'number',
                ...(field.min !== undefined && { minimum: field.min }),
                ...(field.max !== undefined && { maximum: field.max })
            };
            
        case 'checkbox':
            return {
                ...baseSchema,
                type: 'boolean',
                default: field.default || false
            };
            
        case 'select':
            return {
                ...baseSchema,
                type: 'string',
                enum: field.options || [],
                ...(field.default && { default: field.default })
            };
            
        case 'image':
            return {
                ...baseSchema,
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Cloudflare Images ID' },
                    url: { type: 'string', format: 'uri' },
                    alt: { type: 'string', description: 'Alt text for accessibility' }
                },
                required: ['url']
            };
            
        default:
            return {
                ...baseSchema,
                type: 'string'
            };
    }
}

/**
 * Validate content against JSON Schema
 */
export function validate(content, schema) {
    const errors = [];
    
    // Check required fields
    if (schema.required) {
        for (const field of schema.required) {
            if (content[field] === undefined || content[field] === null || content[field] === '') {
                errors.push({
                    field,
                    message: `Required field '${field}' is missing`
                });
            }
        }
    }
    
    // Validate each property
    for (const [key, value] of Object.entries(content)) {
        // Skip metadata
        if (key === '_meta' || key === 'draft' || key === 'published') continue;
        
        const fieldSchema = schema.properties?.[key];
        if (!fieldSchema) {
            // Unknown field (not an error, just skip)
            continue;
        }
        
        const fieldErrors = validateField(key, value, fieldSchema);
        errors.push(...fieldErrors);
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate individual field
 */
function validateField(key, value, schema) {
    const errors = [];
    
    // Type validation
    if (schema.type) {
        const actualType = getJsonType(value);
        if (actualType !== schema.type && value !== null && value !== undefined) {
            errors.push({
                field: key,
                message: `Expected type '${schema.type}', got '${actualType}'`
            });
            return errors; // Stop further validation if type is wrong
        }
    }
    
    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
        if (schema.minLength && value.length < schema.minLength) {
            errors.push({
                field: key,
                message: `Must be at least ${schema.minLength} characters`
            });
        }
        
        if (schema.maxLength && value.length > schema.maxLength) {
            errors.push({
                field: key,
                message: `Must be at most ${schema.maxLength} characters`
            });
        }
        
        if (schema.pattern) {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(value)) {
                errors.push({
                    field: key,
                    message: `Does not match required pattern`
                });
            }
        }
        
        if (schema.format === 'email' && !isValidEmail(value)) {
            errors.push({
                field: key,
                message: 'Invalid email format'
            });
        }
        
        if (schema.format === 'uri' && !isValidUrl(value)) {
            errors.push({
                field: key,
                message: 'Invalid URL format'
            });
        }
        
        if (schema.enum && !schema.enum.includes(value)) {
            errors.push({
                field: key,
                message: `Must be one of: ${schema.enum.join(', ')}`
            });
        }
    }
    
    // Number validations
    if (schema.type === 'number' && typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push({
                field: key,
                message: `Must be at least ${schema.minimum}`
            });
        }
        
        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push({
                field: key,
                message: `Must be at most ${schema.maximum}`
            });
        }
    }
    
    // Object validations
    if (schema.type === 'object' && typeof value === 'object' && value !== null) {
        if (schema.required) {
            for (const requiredField of schema.required) {
                if (!value[requiredField]) {
                    errors.push({
                        field: `${key}.${requiredField}`,
                        message: `Required property '${requiredField}' is missing`
                    });
                }
            }
        }
    }
    
    return errors;
}

/**
 * Get JSON type of value
 */
function getJsonType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * Simple email validation
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Simple URL validation
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}
