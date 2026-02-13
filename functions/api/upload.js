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

import { handleCorsOptions } from './_cors.js';
import { logAudit } from './_audit.js';
import { logError, jsonResponse } from './_response.js';
import { getKVBinding } from './_kv.js';
import { checkKvRateLimit, buildRateLimitKey } from '../lib/rate-limit.js';
import { getBearerToken, getSessionFromRequest } from '../lib/session.js';

const CORS_OPTIONS = { methods: 'POST, OPTIONS' };
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Rate limiting constants
const RATE_LIMIT = { maxRequests: 20, windowMs: 60000 };

/**
 * Main handler
 */
export async function onRequestPost(context) {
    const { request, env } = context;

    const db = getKVBinding(env);
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

    // Rate limit (KV-backed)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let rateLimitOk = true;
    try {
        rateLimitOk = await checkKvRateLimit(db, buildRateLimitKey('upload', ip), {
            maxAttempts: RATE_LIMIT.maxRequests,
            windowMs: RATE_LIMIT.windowMs
        });
    } catch (err) {
        logError(err, 'Upload/RateLimit', env);
    }
    if (!rateLimitOk) {
        return jsonResponse({ error: 'Rate limit exceeded (20 requests/minute). Try again later.' }, 429, env, request);
    }
    
    // Validate session
    const token = getBearerToken(request);
    if (!token) {
        return jsonResponse({ error: 'No authorization token' }, 401, env, request);
    }

    const session = await getSessionFromRequest(db, request);
    if (!session) {
        return jsonResponse({ error: 'Invalid or expired session' }, 401, env, request);
    }
    
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
            logError(new Error(error), 'Upload/Images', env);
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
        logError(error, 'Upload', env);
        return jsonResponse({ 
            error: 'Upload failed'
        }, 500, env, request);
    }
}

/**
 * Handle OPTIONS (CORS preflight)
 */
export async function onRequestOptions(context) {
    return handleCorsOptions(context.env, context.request, CORS_OPTIONS);
}
