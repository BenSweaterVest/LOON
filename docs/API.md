# API Reference

Detailed documentation for LOON's API endpoints.

---

## Overview

LOON exposes three API endpoints via Cloudflare Functions:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth` | POST | Validate credentials |
| `/api/save` | POST | Save content to GitHub |
| `/api/health` | GET | System status check |

All endpoints:
- Return JSON responses
- Include CORS headers for cross-origin requests
- Are rate limited per IP address

---

## Authentication

### POST /api/auth

Validates a page ID and password combination without making any changes.

**Use case:** Verify credentials before loading the editor.

#### Request

```http
POST /api/auth
Content-Type: application/json

{
  "pageId": "demo",
  "password": "loon123"
}
```

#### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | string | Yes | Page identifier (lowercase alphanumeric, hyphens, underscores) |
| `password` | string | Yes | Password for this page |

#### Responses

**Success (200)**
```json
{
  "success": true,
  "pageId": "demo"
}
```

**Invalid Credentials (401)**
```json
{
  "error": "Invalid credentials"
}
```

**Missing Fields (400)**
```json
{
  "error": "Missing required fields: pageId, password"
}
```

**Invalid Page ID Format (400)**
```json
{
  "error": "Invalid page ID format"
}
```

**Rate Limited (429)**
```json
{
  "error": "Rate limit exceeded. Try again in 60 seconds."
}
```

#### Rate Limit

10 requests per minute per IP address.

---

## Save Content

### POST /api/save

Saves content to the GitHub repository.

**Use case:** Persist edited content from the admin panel.

#### Request

```http
POST /api/save
Content-Type: application/json

{
  "pageId": "demo",
  "password": "loon123",
  "content": {
    "headline": "Welcome",
    "body": "Hello world",
    "status": "Active"
  }
}
```

#### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | string | Yes | Page identifier |
| `password` | string | Yes | Password for this page |
| `content` | object | Yes | Content to save (must match schema) |

#### Content Object

The `content` object should contain:
- All fields defined in the page's `schema.json`
- Optional `_meta` object is added automatically

#### Responses

**Success (200)**
```json
{
  "success": true,
  "commit": "abc123def456..."
}
```

The `commit` field contains the Git commit SHA.

**Invalid Credentials (401)**
```json
{
  "error": "Invalid credentials"
}
```

**Missing Fields (400)**
```json
{
  "error": "Missing required fields: pageId, password, content"
}
```

**Content Too Large (413)**
```json
{
  "error": "Content too large",
  "maxSize": 1048576
}
```

**GitHub Error (500)**
```json
{
  "error": "GitHub commit failed",
  "details": "..."
}
```

**Rate Limited (429)**
```json
{
  "error": "Rate limit exceeded. Try again in 60 seconds."
}
```

#### Rate Limit

30 requests per minute per IP address.

#### What Happens

1. Password validated against `USER_{PAGEID}_PASSWORD` environment variable
2. Page ID sanitized (lowercase alphanumeric + hyphens only)
3. Content size checked (max 1MB)
4. Current file SHA retrieved from GitHub (for update)
5. Content committed to `data/{pageId}/content.json`
6. Cloudflare Pages auto-deploys on new commit

---

## Health Check

### GET /api/health

Returns system status and configuration health.

**Use case:** Monitoring, debugging, verify deployment.

#### Request

```http
GET /api/health
```

No parameters required.

#### Response

**Healthy (200)**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "mode": "team",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```

**Degraded (503)**
```json
{
  "status": "degraded",
  "version": "2.0.0",
  "mode": "directory",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "checks": {
    "github_repo": true,
    "github_token": false,
    "kv_database": false
  }
}
```

#### Fields

| Field | Description |
|-------|-------------|
| `status` | `ok` or `degraded` |
| `version` | LOON version number |
| `mode` | Operating mode: `directory` (Phase 1) or `team` (Phase 2) |
| `timestamp` | Current server time (ISO 8601) |
| `checks.github_repo` | `GITHUB_REPO` env var is set |
| `checks.github_token` | `GITHUB_TOKEN` env var is set |
| `checks.kv_database` | `LOON_DB` KV namespace is bound (Phase 2 only) |

**Note:** The health endpoint does not verify that credentials are valid, only that they are present. The `kv_database` check is optional - the system works in Phase 1 mode without it.

---

## CORS

All endpoints include CORS headers to allow cross-origin requests.

### Phase 1 Endpoints

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### Phase 2 Endpoints

Phase 2 endpoints require the `Authorization` header, so they include:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### Configurable Origin

Set the `CORS_ORIGIN` environment variable to restrict access to a specific domain:

```
CORS_ORIGIN=https://your-domain.com
```

If not set, defaults to `*` (allow all origins). See [SECURITY.md](../SECURITY.md#cors-configuration) for details.

OPTIONS requests return these headers with a 204 status.

---

## Error Handling

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "details": "Optional additional information"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (missing or invalid parameters) |
| 401 | Unauthorized (invalid credentials) |
| 413 | Payload too large (content > 1MB) |
| 429 | Rate limit exceeded |
| 500 | Server error (usually GitHub API issue) |
| 503 | Service unavailable (health check degraded) |

---

## Rate Limiting

Rate limits are tracked per IP address using Cloudflare's `CF-Connecting-IP` header.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth` | 10 requests | 60 seconds |
| `/api/save` | 30 requests | 60 seconds |
| `/api/health` | No limit | - |

When rate limited, wait 60 seconds before retrying.

---

## Security

### Password Comparison

Passwords are compared using `crypto.subtle.timingSafeEqual` to prevent timing attacks.

### Input Sanitization

Page IDs are sanitized:
- Converted to lowercase
- Non-alphanumeric characters (except hyphens and underscores) removed
- Prevents path traversal attacks

### Content Limits

- Maximum request size: 1MB
- Enforced both by Content-Length header and post-parse check

---

## Environment Variables

The API requires these environment variables in Cloudflare:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_REPO` | Yes | Repository in `owner/repo` format |
| `GITHUB_TOKEN` | Yes | GitHub Personal Access Token |
| `USER_{PAGEID}_PASSWORD` | Per page | Password for each page |

---

## Examples

### cURL Examples

**Authenticate:**
```bash
curl -X POST https://your-site.pages.dev/api/auth \
  -H "Content-Type: application/json" \
  -d '{"pageId":"demo","password":"loon123"}'
```

**Save content:**
```bash
curl -X POST https://your-site.pages.dev/api/save \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "demo",
    "password": "loon123",
    "content": {
      "headline": "Hello World",
      "status": "Active",
      "body": "Updated content"
    }
  }'
```

**Health check:**
```bash
curl https://your-site.pages.dev/api/health
```

### JavaScript Examples

```javascript
// Authenticate
const authRes = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pageId: 'demo', password: 'loon123' })
});

// Save
const saveRes = await fetch('/api/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pageId: 'demo',
    password: 'loon123',
    content: { headline: 'Hello', status: 'Active', body: 'Content' }
  })
});
```

---

# Phase 2 API (Team Mode)

Phase 2 adds session-based authentication with RBAC. These endpoints require Cloudflare KV setup.

## Overview

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth-v2` | GET | Verify session token |
| `/api/auth-v2` | POST | Login, get session token |
| `/api/auth-v2` | PATCH | Change own password |
| `/api/auth-v2` | DELETE | Logout, invalidate session |
| `/api/save-v2` | POST | Save with RBAC enforcement |
| `/api/users` | GET/POST/PATCH/DELETE | User management (admin only) |

---

## GET /api/auth-v2

Verify if a session token is still valid and get session information.

### Request

```http
GET /api/auth-v2
Authorization: Bearer <session-token>
```

### Response (Valid Session)

```json
{
  "valid": true,
  "username": "admin",
  "role": "admin",
  "expiresIn": 43200
}
```

### Response (Invalid/Expired)

```json
{
  "valid": false,
  "error": "Session expired or invalid"
}
```

---

## POST /api/auth-v2

Login with username and password, receive session token.

### Request

```http
POST /api/auth-v2
Content-Type: application/json

{
  "username": "admin",
  "password": "yourpassword"
}
```

### Response (Success)

```json
{
  "success": true,
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "role": "admin",
  "username": "admin",
  "expiresIn": 86400
}
```

### Response (Error)

```json
{
  "error": "Invalid credentials"
}
```

### Rate Limit

5 login attempts per minute per IP.

---

## PATCH /api/auth-v2

Change your own password (requires valid session).

### Request

```http
PATCH /api/auth-v2
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

### Response (Error)

```json
{
  "error": "Current password is incorrect"
}
```

### Validation

- `currentPassword`: Must match your current password
- `newPassword`: Minimum 8 characters

---

## DELETE /api/auth-v2

Logout and invalidate session token.

### Request

```http
DELETE /api/auth-v2
Authorization: Bearer <session-token>
```

### Response

```json
{
  "success": true,
  "message": "Logged out"
}
```

---

## POST /api/save-v2

Save content with RBAC enforcement.

### Request

```http
POST /api/save-v2
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "pageId": "my-page",
  "content": {
    "title": "My Content",
    "body": "Hello world"
  }
}
```

### Response (Success)

```json
{
  "success": true,
  "commit": "abc123...",
  "pageId": "my-page",
  "modifiedBy": "admin"
}
```

### RBAC Rules

| Role | Create | Edit Own | Edit Others |
|------|--------|----------|-------------|
| Admin | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes |
| Contributor | Yes | Yes | No |

Contributors receive 403 if trying to edit content created by others.

### Automatic Metadata

Saved content automatically includes:

```json
{
  "_meta": {
    "createdBy": "username",
    "created": "2026-01-30T12:00:00Z",
    "modifiedBy": "username",
    "lastModified": "2026-01-30T12:00:00Z"
  }
}
```

---

## User Management API

**Admin only.** Requires valid admin session token.

### GET /api/users

List all users.

```http
GET /api/users
Authorization: Bearer <admin-token>
```

Response:

```json
{
  "users": [
    { "username": "admin", "role": "admin", "created": "2026-01-30T12:00:00Z" },
    { "username": "jane", "role": "editor", "created": "2026-01-30T12:00:00Z" }
  ]
}
```

### POST /api/users

Create new user.

```http
POST /api/users
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "username": "newuser",
  "role": "contributor",
  "password": "optional-if-you-want-to-set-it"
}
```

Response:

```json
{
  "success": true,
  "username": "newuser",
  "password": "auto-generated-if-not-provided",
  "role": "contributor",
  "message": "User created. Share the password securely with the user."
}
```

### PATCH /api/users

Update user role or reset password.

```http
PATCH /api/users
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "username": "jane",
  "role": "admin",
  "resetPassword": true
}
```

Response:

```json
{
  "success": true,
  "username": "jane",
  "newRole": "admin",
  "newPassword": "auto-generated",
  "message": "Password reset. Share the new password securely."
}
```

### DELETE /api/users

Delete user and invalidate their sessions.

```http
DELETE /api/users
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "username": "jane"
}
```

Response:

```json
{
  "success": true,
  "message": "User jane deleted"
}
```

---

## GET /api/pages

List available pages. Works with both Phase 1 and Phase 2.

### Request

```http
GET /api/pages
Authorization: Bearer <session-token>  (optional)
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minimal` | boolean | false | If true, returns only pageId (faster, fewer API calls) |
| `page` | integer | 1 | Page number for pagination |
| `limit` | integer | 20 | Items per page (max 100) |

### Response

```json
{
  "pages": [
    {
      "pageId": "demo",
      "title": "Demo Page",
      "hasContent": true,
      "hasSchema": true,
      "createdBy": "admin",
      "modifiedBy": "admin",
      "lastModified": "2026-01-30T12:00:00.000Z"
    }
  ],
  "mode": "team",
  "canEditAll": true,
  "total": 25,
  "page": 1,
  "limit": 20,
  "hasMore": true
}
```

### Minimal Response

With `?minimal=true`:

```json
{
  "pages": [
    { "pageId": "demo", "title": "demo" },
    { "pageId": "about", "title": "about" }
  ],
  "mode": "team",
  "canEditAll": true,
  "total": 2,
  "page": 1,
  "limit": 20,
  "hasMore": false
}
```

### Notes

- Without authentication: Returns all pages
- With contributor token: Returns only pages they created
- With editor/admin token: Returns all pages
- Directory listing is cached for 60 seconds to reduce GitHub API calls

---

## GET /api/sessions

List active sessions. Admin only. Phase 2.

### Request

```http
GET /api/sessions
Authorization: Bearer <admin-token>
```

### Response

```json
{
  "sessions": [
    {
      "tokenPreview": "550e8400...",
      "username": "admin",
      "role": "admin",
      "created": "2026-01-30T12:00:00.000Z",
      "ip": "192.168.1.1",
      "isCurrent": true
    }
  ],
  "total": 1
}
```

---

## DELETE /api/sessions

Revoke sessions. Admin only. Phase 2.

### Revoke All Sessions for User

```http
DELETE /api/sessions
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "username": "jane",
  "all": true
}
```

### Response

```json
{
  "success": true,
  "revoked": 3,
  "message": "Revoked 3 session(s)"
}
```

### Notes

- Cannot revoke your own session
- Useful for security incidents or when user leaves team

---

## DELETE /api/content

Delete a page's content. Admin or Editor only. Phase 2.

### Request

```http
DELETE /api/content
Authorization: Bearer <admin-or-editor-token>
Content-Type: application/json

{
  "pageId": "old-page"
}
```

### Response

```json
{
  "success": true,
  "message": "Content for \"old-page\" deleted",
  "commit": "abc123...",
  "deletedBy": "admin"
}
```

### Notes

- Deletes `content.json` only, not `schema.json`
- Page structure remains, allowing content to be recreated
- To fully remove a page, delete the folder via Git
- Contributors cannot delete content (403)

---

## Phase 2 JavaScript Examples

```javascript
// Login and store token
async function login(username, password) {
  const res = await fetch('/api/auth-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.success) {
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('role', data.role);
  }
  return data;
}

// Save with token
async function saveContent(pageId, content) {
  const token = sessionStorage.getItem('token');
  const res = await fetch('/api/save-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ pageId, content })
  });
  return res.json();
}

// Logout
async function logout() {
  const token = sessionStorage.getItem('token');
  await fetch('/api/auth-v2', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('role');
}
```
