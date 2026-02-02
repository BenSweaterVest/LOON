# API Reference

Detailed documentation for LOON's API endpoints (v3.1.0).

---

## Overview

LOON exposes the following API endpoints via Cloudflare Functions:

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/auth` | GET, POST, PATCH, DELETE | Authentication & sessions |
| `/api/save` | POST | Save content to GitHub |
| `/api/pages` | GET, POST | List and create pages |
| `/api/publish` | POST | Publish/unpublish content |
| `/api/upload` | POST | Upload images (Cloudflare Images) |
| `/api/templates` | GET | List schema templates |
| `/api/users` | GET, POST, PATCH, DELETE | User management (admin) |
| `/api/sessions` | GET, DELETE | Session management (admin) |
| `/api/content` | DELETE | Delete content |
| `/api/audit` | GET | View audit logs (admin) |
| `/api/health` | GET | System status check |

All endpoints:
- Return JSON responses
- Include CORS headers for cross-origin requests
- Are rate limited per IP address

---

## Authentication

### POST /api/auth

Login with username and password to receive a session token.

#### Request

```http
POST /api/auth
Content-Type: application/json

{
  "username": "admin",
  "password": "secret123"
}
```

#### Response (200)

```json
{
  "success": true,
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "role": "admin",
  "username": "admin",
  "expiresIn": 86400
}
```

#### Errors

| Status | Error |
|--------|-------|
| 400 | Username and password required |
| 401 | Invalid credentials |
| 429 | Too many login attempts |

#### Rate Limit

5 attempts per minute per IP address.

---

### GET /api/auth

Verify a session token is still valid.

#### Request

```http
GET /api/auth
Authorization: Bearer <session-token>
```

#### Response (200)

```json
{
  "valid": true,
  "username": "admin",
  "role": "admin",
  "expiresIn": 82800
}
```

---

### PATCH /api/auth

Change your own password.

#### Request

```http
PATCH /api/auth
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

#### Response (200)

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

---

### DELETE /api/auth

Logout and invalidate session token.

#### Request

```http
DELETE /api/auth
Authorization: Bearer <session-token>
```

#### Response (200)

```json
{
  "success": true,
  "message": "Logged out"
}
```

---

## Content Management

### POST /api/save

Save content to GitHub repository.

**Roles:** Admin, Editor, Contributor (own content only)

#### Request

```http
POST /api/save
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "pageId": "demo",
  "saveAs": "draft",
  "content": {
    "title": "My Title",
    "body": "Content here..."
  }
}
```

#### Response (200)

```json
{
  "success": true,
  "commit": "abc123def456",
  "pageId": "demo",
  "modifiedBy": "admin",
  "status": "draft",
  "saveType": "draft"
}
```

#### Errors

| Status | Error |
|--------|-------|
| 400 | pageId and content required |
| 401 | Invalid or expired session |
| 403 | Contributors can only edit content they created |
| 413 | Content exceeds 1MB limit |
| 429 | Rate limit exceeded |

#### Rate Limit

30 requests per minute per IP address.

---

### POST /api/publish

Publish or unpublish content.

**Roles:** Admin, Editor

#### Request

```http
POST /api/publish
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "pageId": "demo",
  "action": "publish"
}
```

#### Response (200)

```json
{
  "success": true,
  "pageId": "demo",
  "status": "published",
  "publishedBy": "admin",
  "publishedAt": "2026-02-02T12:00:00Z"
}
```

---

### POST /api/upload

Upload an image to Cloudflare Images.

**Roles:** Any authenticated user

#### Request

```http
POST /api/upload
Authorization: Bearer <session-token>
Content-Type: multipart/form-data
```

Form field: `file` (JPEG/PNG/GIF/WebP, max 10MB)

#### Response (200)

```json
{
  "success": true,
  "id": "abc123",
  "url": "https://imagedelivery.net/{account}/abc123/public",
  "variants": {
    "thumbnail": "https://imagedelivery.net/{account}/abc123/thumbnail",
    "medium": "https://imagedelivery.net/{account}/abc123/medium",
    "large": "https://imagedelivery.net/{account}/abc123/large"
  }
}
```

---

### DELETE /api/content

Delete page content (content.json). Schema remains.

**Roles:** Admin, Editor only

#### Request

```http
DELETE /api/content
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "pageId": "demo"
}
```

#### Response (200)

```json
{
  "success": true,
  "message": "Content for \"demo\" deleted",
  "commit": "abc123def456",
  "deletedBy": "admin"
}
```

---

## Pages

### GET /api/pages

List available pages. Contributors see only their pages.

#### Request

```http
GET /api/pages
Authorization: Bearer <session-token>  (optional)
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| minimal | boolean | false | Return only pageId list |
| page | number | 1 | Page number |
| limit | number | 20 | Items per page (max 100) |

#### Response (200)

```json
{
  "pages": [
    {
      "pageId": "demo",
      "title": "Demo Page",
      "hasContent": true,
      "createdBy": "admin",
      "lastModified": "2026-01-30T12:00:00Z"
    }
  ],
  "canEditAll": true,
  "total": 25,
  "page": 1,
  "limit": 20,
  "hasMore": true
}
```

---

### POST /api/pages

Create a new page.

**Roles:** Admin, Editor only

#### Request

```http
POST /api/pages
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "pageId": "my-new-page",
  "title": "My New Page",
  "template": "blog-post"
}
```

#### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pageId | string | Yes | 3-50 chars, lowercase alphanumeric + hyphens |
| title | string | No | Human-readable title |
| template | string | No | Template name from examples/ |
| schema | object | No | Custom schema (overrides template) |

#### Response (201)

```json
{
  "success": true,
  "pageId": "my-new-page",
  "schemaCommit": "abc123",
  "contentCommit": "def456",
  "createdBy": "admin"
}
```

---

## Templates

### GET /api/templates

List available schema templates from the examples/ folder.

#### Request

```http
GET /api/templates
```

#### Response (200)

```json
{
  "templates": [
    {
      "id": "blog-post",
      "title": "Blog Post Editor",
      "description": "Create or edit a blog post",
      "fieldCount": 6
    }
  ],
  "total": 16
}
```

---

## User Management

**All user endpoints require Admin role.**

### GET /api/users

List all users.

#### Response (200)

```json
{
  "users": [
    {
      "username": "admin",
      "role": "admin",
      "created": "2026-01-30T12:00:00Z",
      "createdBy": "bootstrap"
    }
  ]
}
```

---

### POST /api/users

Create a new user.

#### Request

```json
{
  "username": "newuser",
  "role": "editor",
  "password": "optional123"
}
```

If password is omitted, a secure random password is generated.

#### Response (201)

```json
{
  "success": true,
  "username": "newuser",
  "password": "generated-or-provided",
  "role": "editor",
  "message": "User created. Share the password securely with the user."
}
```

---

### PATCH /api/users

Update user role or reset password.

#### Request

```json
{
  "username": "someuser",
  "role": "contributor",
  "resetPassword": true
}
```

---

### DELETE /api/users

Delete a user and all their sessions.

#### Request

```json
{
  "username": "someuser"
}
```

---

## Sessions

**All session endpoints require Admin role.**

### GET /api/sessions

List active sessions.

### DELETE /api/sessions

Revoke sessions for a user.

#### Request

```json
{
  "username": "someuser",
  "all": true
}
```

---

## Audit Logs

### GET /api/audit

View audit logs.

**Roles:** Admin only

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| action | string | - | Filter by action type |
| username | string | - | Filter by username |
| limit | number | 100 | Max results (max 500) |

#### Response (200)

```json
{
  "logs": [
    {
      "action": "login",
      "username": "admin",
      "details": { "ip": "1.2.3.4" },
      "timestamp": "2026-01-30T12:00:00Z"
    }
  ],
  "total": 50
}
```

#### Tracked Actions

- `login` - User logged in
- `logout` - User logged out
- `password_change` - User changed password
- `content_save` - Content saved
- `content_delete` - Content deleted
- `page_create` - Page created
- `user_create` - User created
- `user_delete` - User deleted
- `user_update` - User role changed
- `password_reset` - Admin reset user password

---

## Health Check

### GET /api/health

System status and configuration check.

#### Response (200)

```json
{
  "status": "ok",
  "version": "3.1.0",
  "timestamp": "2026-01-30T12:00:00Z",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```

#### Status Values

- `ok` - All checks pass
- `degraded` - One or more checks failed

#### HTTP Status

- 200 - Healthy
- 503 - Degraded

---

## CORS

All endpoints support CORS with configurable origin via the `CORS_ORIGIN` environment variable.

Default: `*` (all origins)

Set `CORS_ORIGIN=https://example.com` to restrict to specific domain.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here"
}
```

Common status codes:

| Status | Meaning |
|--------|---------|
| 400 | Bad request (invalid input) |
| 401 | Unauthorized (not logged in or invalid session) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 409 | Conflict (e.g., page already exists) |
| 413 | Payload too large |
| 429 | Rate limited |
| 500 | Internal server error |
| 503 | Service unavailable (degraded health) |
