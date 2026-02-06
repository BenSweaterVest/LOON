/**
 * ============================================================================
 * LOON Upload Endpoint (functions/api/upload.js)
 * ============================================================================
 *
 * Media upload management using Cloudflare Images.
 * Allows authenticated users to upload images for use in content.
 *
 * ENDPOINT: POST /api/upload
 *
 * REQUEST HEADERS:
 *   Authorization: Bearer <session-token>
 *   Content-Type: multipart/form-data
 *
 * REQUEST BODY:
 *   Form data with 'file' field containing image
 *
 * RESPONSE (Success):
 *   {
 *     "success": true,
 *     "id": "abc123",
 *     "url": "https://imagedelivery.net/{account}/abc123/public",
 *     "variants": {
 *       "thumbnail": "https://imagedelivery.net/{account}/abc123/thumbnail",
 *       "medium": "https://imagedelivery.net/{account}/abc123/medium",
 *       "large": "https://imagedelivery.net/{account}/abc123/large"
 *     }
 *   }
 *
 * PERMISSIONS:
 *   - All authenticated users can upload images
 *
 * REQUIREMENTS:
 *   - CF_ACCOUNT_ID environment variable
 *   - CF_IMAGES_TOKEN environment variable (API token with Images:Edit permission)
 *
 * LIMITS:
 *   - Max file size: 10MB
 *   - Supported formats: JPEG, PNG, GIF, WebP
 *   - Free tier: 100,000 images
 *
 * @module functions/api/upload

 */

import { getCorsHeaders, handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate session
 */
async function validateSession(db, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'No authorization token' };
    }
    
    const token = authHeader.slice(7);
    const sessionKey = `session:${token}`;
    const sessionRaw = await db.get(sessionKey);
    
    if (!sessionRaw) {
        return { valid: false, error: 'Invalid or expired session' };
    }
    
    const session = JSON.parse(sessionRaw);
    return { valid: true, session };
}

/**
 * Main handler
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return handleCorsOptions(env, request, CORS_OPTIONS);
    }
    
    const db = env.LOON_DB;
    if (!db) {
        return jsonResponse({ error: 'Database not configured' }, 500, env, request);
    }
    
    // Check for Cloudflare Images configuration
    if (!env.CF_ACCOUNT_ID || !env.CF_IMAGES_TOKEN) {
        return jsonResponse({ 
            error: 'Image uploads not configured',
            details: 'CF_ACCOUNT_ID and CF_IMAGES_TOKEN environment variables required'
        }, 503, env, request);
    }
    
    // Validate session
    const authHeader = request.headers.get('Authorization');
    const auth = await validateSession(db, authHeader);
    
    if (!auth.valid) {
        return jsonResponse({ error: auth.error || 'Unauthorized' }, 401, env, request);
    }
    
    const { session } = auth;
    
    try {
        // Parse multipart form data
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
            return jsonResponse({ error: 'No file provided' }, 400, env, request);
        }
        
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            return jsonResponse({ 
                error: 'File too large',
                maxSize: '10MB',
                actualSize: `${(file.size / (1024 * 1024)).toFixed(2)}MB`
            }, 413, env, request);
        }
        
        // Check file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return jsonResponse({ 
                error: 'Invalid file type',
                allowed: allowedTypes,
                received: file.type
            }, 400, env, request);
        }
        
        // Upload to Cloudflare Images
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        
        const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v1`;
        
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.CF_IMAGES_TOKEN}`
            },
            body: uploadFormData
        });
        
        if (!uploadRes.ok) {
            const error = await uploadRes.text();
            logError(new Error(error), 'Upload/Images');
            return jsonResponse({ 
                error: 'Image upload failed',
                details: `Upload service error (${uploadRes.status})`
            }, 500, env, request);
        }
        
        const uploadData = await uploadRes.json();
        
        if (!uploadData.success) {
            return jsonResponse({ 
                error: 'Upload failed',
                details: uploadData.errors || 'Unknown error'
            }, 500, env, request);
        }
        
        const image = uploadData.result;
        
        // Store image metadata in KV
        const imageMetadata = {
            id: image.id,
            filename: file.name,
            uploadedBy: session.username,
            uploadedAt: new Date().toISOString(),
            size: file.size,
            type: file.type
        };
        
        await db.put(`image:${image.id}`, JSON.stringify(imageMetadata));
        
        // Log audit
        await logAudit(db, 'image_upload', session.username, {
            imageId: image.id,
            filename: file.name,
            size: file.size,
            ip: request.headers.get('CF-Connecting-IP')
        });
        
        // Return response
        return jsonResponse({
            success: true,
            id: image.id,
            filename: file.name,
            url: image.variants[0], // Default variant
            variants: {
                public: image.variants.find(v => v.includes('/public')) || image.variants[0],
                thumbnail: image.variants.find(v => v.includes('/thumbnail')),
                medium: image.variants.find(v => v.includes('/medium')),
                large: image.variants.find(v => v.includes('/large'))
            },
            uploaded: {
                by: session.username,
                at: imageMetadata.uploadedAt
            }
        }, 200, env, request);
        
    } catch (error) {
        logError(error, 'Upload');
        return jsonResponse({ 
            error: 'Upload failed'
        }, 500, env, request);
    }
}
