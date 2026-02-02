# Error Codes & HTTP Status Reference

Standardized HTTP status codes used throughout LOON v3.1.0 API endpoints.

## HTTP Status Codes

### 2xx Success

| Code | Meaning | Common Endpoints |
|------|---------|------------------|
| **200** | OK - Request succeeded | All GET/POST/PATCH endpoints with success |
| **201** | Created - Resource created | POST /api/pages, /api/users |

### 4xx Client Errors

| Code | Meaning | Common Causes |
|------|---------|---------------|
| **400** | Bad Request - Invalid input | Missing required fields, invalid JSON, validation failed |
| **401** | Unauthorized - Missing/invalid credentials | No auth header, expired token, invalid credentials |
| **403** | Forbidden - Insufficient permissions | Contributor trying to publish, Admin-only endpoint |
| **404** | Not Found - Resource doesn't exist | Page not found, user not found, file doesn't exist |
| **409** | Conflict - Resource already exists | Creating user that already exists, duplicate page ID |
| **413** | Payload Too Large - Request too large | File exceeds 10MB (upload), content exceeds 1MB (save) |
| **429** | Too Many Requests - Rate limited | >5 login attempts/min, >30 save requests/min |

### 5xx Server Errors

| Code | Meaning | Common Causes |
|------|---------|---------------|
| **500** | Internal Server Error - Server error | Unhandled exception, GitHub API error, KV error |
| **503** | Service Unavailable - Missing config | Images not configured (upload endpoint) |

---

## Error Response Format

All error responses follow this standard format:

```json
{
  "error": "Human-readable error message",
  "status": 400,
  "details": "Optional additional context"
}
```

### Examples

**Missing Required Field:**
```json
{
  "error": "pageId and action required",
  "status": 400
}
```

**Authentication Failed:**
```json
{
  "error": "Invalid or expired session",
  "status": 401
}
```

**Rate Limited:**
```json
{
  "error": "Too many requests. Try again in 60 seconds",
  "status": 429
}
```

**Permission Denied:**
```json
{
  "error": "Only admins and editors can publish content",
  "status": 403,
  "details": { "role": "contributor" }
}
```

---

## Endpoint-Specific Errors

### Authentication Endpoint (`/api/auth`)

| Status | Scenario |
|--------|----------|
| **200** | Login successful, session created |
| **400** | Username/password missing or invalid format |
| **401** | Invalid username or password |
| **429** | 5+ login attempts in 60 seconds from same IP |
| **500** | Password hashing or KV storage failed |

### Save Endpoint (`/api/save`)

| Status | Scenario |
|--------|----------|
| **200** | Content saved successfully |
| **400** | Missing pageId or content, invalid JSON |
| **401** | No auth token or invalid token |
| **403** | Contributor trying to save as published (must be draft) |
| **404** | Page ID doesn't exist |
| **413** | Content exceeds 1MB limit |
| **429** | 30+ requests in 60 seconds from same IP |
| **500** | GitHub API error or content encoding failed |

### Publish Endpoint (`/api/publish`)

| Status | Scenario |
|--------|----------|
| **200** | Content published/unpublished successfully |
| **400** | Missing pageId/action, no draft to publish |
| **401** | No auth token or invalid token |
| **403** | Contributor cannot publish (admin/editor only) |
| **404** | Page not found in GitHub |
| **500** | GitHub API error during commit |

### Upload Endpoint (`/api/upload`)

| Status | Scenario |
|--------|----------|
| **200** | Image uploaded successfully |
| **400** | No file in form data, invalid MIME type |
| **401** | No auth token or invalid token |
| **413** | File exceeds 10MB limit |
| **503** | Cloudflare Images not configured |
| **500** | Cloudflare Images API error |

### Health Endpoint (`/api/health`)

| Status | Scenario |
|--------|----------|
| **200** | System fully operational (all required checks pass) |
| **503** | System degraded (missing GITHUB_REPO, GITHUB_TOKEN, or KV_DB) |

---

## Rate Limiting

LOON implements per-IP rate limiting on sensitive endpoints:

### Auth Endpoint
- **Limit**: 5 login attempts per minute per IP
- **Response**: 429 Too Many Requests after 5 attempts
- **Reset**: Automatic after 60 seconds

### Save Endpoint
- **Limit**: 30 save requests per minute per IP
- **Response**: 429 Too Many Requests after 30 requests
- **Reset**: Automatic after 60 seconds

---

## Troubleshooting Common Errors

### "401 Invalid or expired session"
- **Cause**: Session token missing, invalid, or expired (24h TTL)
- **Fix**: Re-authenticate with `/api/auth`

### "403 Only admins and editors can publish"
- **Cause**: Your role is 'contributor' which cannot publish
- **Fix**: Ask an admin to change your role, or have them publish for you

### "429 Too many requests"
- **Cause**: You've exceeded rate limit for this IP
- **Fix**: Wait 60 seconds and try again

### "413 Payload too large"
- **Cause**: Content or file exceeds size limit
- **Fix**: Reduce content size (max 1MB for save, 10MB for uploads)

### "503 Service unavailable"
- **Cause**: Cloudflare Images not configured
- **Fix**: See `.env.example` for image setup requirements

---

## Security Considerations

- All error messages avoid leaking sensitive information
- Invalid credentials return generic 401 (no username enumeration)
- Rate limiting prevents brute force attacks
- Session tokens use secure random UUIDs
- Passwords are hashed with PBKDF2 (100,000 iterations)

