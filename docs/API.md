# API Reference

Complete documentation for LOON's API endpoints.

---

## Overview

LOON exposes the following API endpoints via Cloudflare Functions:

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/auth` | GET, POST, PATCH, DELETE | Password authentication & sessions |
| `/api/passkeys/register/challenge` | GET | Get challenge for passkey registration |
| `/api/passkeys/register/verify` | POST | Verify passkey registration attestation |
| `/api/passkeys/auth/challenge` | GET | Get challenge for passkey authentication |
| `/api/passkeys/auth/verify` | POST | Verify passkey authentication assertion |
| `/api/passkeys` | GET | List user's passkeys |
| `/api/passkeys/:credentialId` | PATCH, DELETE | Update or delete passkey |
| `/api/passkeys/recovery/verify` | POST | Verify recovery code |
| `/api/passkeys/recovery/disable` | POST | Disable all passkeys |
| `/api/save` | POST | Save content to GitHub |
| `/api/pages` | GET, POST | List and create pages |
| `/api/publish` | POST | Publish/unpublish content |
| `/api/upload` | POST | Upload images (Cloudflare Images) |
| `/api/templates` | GET | List schema templates |
| `/api/users` | GET, POST, PATCH, DELETE | User management (admin) |
| `/api/sessions` | GET, DELETE | Session management (admin) |
| `/api/content` | DELETE | Delete content |
| `/api/audit` | GET | View audit logs (admin) |
| `/api/setup` | GET, POST | One-time first admin setup |
| `/api/health` | GET | System status check |

All endpoints:
- Return JSON responses
- Include CORS headers for cross-origin requests
- Are rate limited per IP address

### Client Examples

The following examples show how to interact with LOON API from different clients:

**Configuration**: WebAuthn relying party ID is determined by:
1. `RP_ID` environment variable (if set)
2. Otherwise extracted from request URL hostname

For local development, set `RP_ID=localhost` and `RP_ORIGIN=http://localhost:8788` in `.env.local`.

#### JavaScript (Fetch)

```javascript
// Login
const loginResponse = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'password123' })
});
const { token } = await loginResponse.json();

// Verify session
const authResponse = await fetch('/api/auth', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { valid, role } = await authResponse.json();

// Save content
const saveResponse = await fetch('/api/save', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    pageId: 'my-page',
    content: { title: 'Hello', body: 'World' }
  })
});
const { success, metadata } = await saveResponse.json();
```

#### Python

```python
import requests
import json

BASE_URL = "https://your-domain.com"

# Login
response = requests.post(f'{BASE_URL}/api/auth', json={
    'username': 'admin',
    'password': 'password123'
})
token = response.json()['token']

# Verify session
response = requests.get(
    f'{BASE_URL}/api/auth',
    headers={'Authorization': f'Bearer {token}'}
)
user = response.json()

# Save content
response = requests.post(
    f'{BASE_URL}/api/save',
    headers={'Authorization': f'Bearer {token}'},
    json={
        'pageId': 'my-page',
        'content': {'title': 'Hello', 'body': 'World'}
    }
)
result = response.json()
```

#### cURL

```bash
# Login
TOKEN=$(curl -s -X POST https://your-domain.com/api/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}' \
  | jq -r '.token')

# Verify session
curl https://your-domain.com/api/auth \
  -H "Authorization: Bearer $TOKEN" | jq .

# Save content
curl -X POST https://your-domain.com/api/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "my-page",
    "content": {"title": "Hello", "body": "World"}
  }' | jq .

# Check health
curl https://your-domain.com/api/health | jq .
```

---
## Authentication

### GET /api/setup

Check whether initial setup is required.

#### Response (200)

```json
{
  "setupRequired": true,
  "setupTokenConfigured": true
}
```

### POST /api/setup

Create first admin account when no admin exists.

#### Request

```http
POST /api/setup
Content-Type: application/json

{
  "setupToken": "<SETUP_TOKEN>",
  "username": "admin",
  "password": "StrongPassword123"
}
```

#### Response (201)

```json
{
  "success": true,
  "message": "Initial admin created successfully",
  "token": "session-token",
  "username": "admin",
  "role": "admin",
  "expiresIn": 86400
}
```

#### Notes

- Requires `SETUP_TOKEN` env var to be configured.
- Works only while no admin user exists.
- Password is hashed before storage.

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

## Passkey Authentication (WebAuthn/FIDO2)

### GET /api/passkeys/register/challenge

Get a challenge for registering a new passkey.

**Auth Required:** Yes (Bearer token)

#### Request

```http
GET /api/passkeys/register/challenge
Authorization: Bearer <session-token>
```

#### Response (200)

```json
{
  "challenge": "base64url-encoded-challenge",
  "challengeToken": "base64url-token-to-pass-to-verify",
  "userId": "base64url(sha256(username))",
  "username": "admin",
  "rpId": "example.com",
  "rpName": "LOON CMS",
  "attestation": "direct",
  "timeout": 60000,
  "authenticatorSelection": {
    "authenticatorAttachment": "platform",
    "userVerification": "preferred",
    "residentKey": "discouraged"
  },
  "pubKeyCredParams": [
    { "alg": -7, "type": "public-key" }
  ]
}
```

**Passkeys readiness note**: Registration validates `clientData` fields and COSE key structure, but does not verify attestation certificate chains or trust anchors.

### POST /api/passkeys/register/verify

Verify passkey registration and generate recovery codes.

**Auth Required:** Yes (Bearer token)

#### Request

```http
POST /api/passkeys/register/verify
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "attestationResponse": { /* WebAuthn attestationResponse object */ },
  "deviceName": "iPhone 15",
  "challengeToken": "base64url-token-from-challenge"
}
```

#### Response (201)

```json
{
  "success": true,
  "recoveryCodes": ["ABC12345", "DEF67890", "...12 total codes..."],
  "message": "Passkey registered successfully. Save your recovery codes!"
}
```

#### Errors

| Status | Error |
|--------|-------|
| 400 | Invalid attestation response |
| 401 | Unauthorized |

### GET /api/passkeys/auth/challenge

Get a challenge for passkey authentication (public endpoint, no auth required).

#### Request

```http
GET /api/passkeys/auth/challenge?usernamehint=admin
```

#### Response (200)

```json
{
  "challenge": "base64url-encoded-challenge",
  "challengeToken": "base64url-token-to-pass-to-verify",
  "rpId": "example.com",
  "allowCredentials": [
    {
      "id": "base64url-encoded-credential-id",
      "type": "public-key",
      "transports": ["internal"]
    }
  ],
  "timeout": 60000,
  "userVerification": "preferred"
}
```

### POST /api/passkeys/auth/verify

Verify passkey authentication and return session token.

#### Request

```http
POST /api/passkeys/auth/verify
Content-Type: application/json

{
  "assertionResponse": { /* WebAuthn assertionResponse object */ }
}
```

#### Response (200)

```json
{
  "success": true,
  "token": "session-token-here",
  "username": "admin",
  "role": "admin",
  "expiresIn": 86400
}
```

#### Errors

| Status | Error |
|--------|-------|
| 400 | Invalid assertion response |
| 401 | Authentication failed |

### GET /api/passkeys

List all passkeys registered for the current user.

**Auth Required:** Yes (Bearer token)

#### Request

```http
GET /api/passkeys
Authorization: Bearer <session-token>
```

#### Response (200)

```json
{
  "passkeys": [
    {
      "id": "credential-id-base64",
      "name": "iPhone 15",
      "created": 1706913600000,
      "lastUsed": 1706913615000,
      "transports": ["internal"]
    }
  ]
}
```

### PATCH /api/passkeys/:credentialId

Update passkey name/display label.

**Auth Required:** Yes (Bearer token)

#### Request

```http
PATCH /api/passkeys/credential-id-base64
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "name": "My New Device Name"
}
```

#### Response (200)

```json
{
  "success": true
}
```

### DELETE /api/passkeys/:credentialId

Delete/unregister a passkey.

**Auth Required:** Yes (Bearer token)

#### Request

```http
DELETE /api/passkeys/credential-id-base64
Authorization: Bearer <session-token>
```

#### Response (200)

```json
{
  "success": true
}
```

### POST /api/passkeys/recovery/verify

Verify recovery code and get temporary authentication token for account recovery.

**Auth Required:** No (public endpoint)

#### Request

```http
POST /api/passkeys/recovery/verify
Content-Type: application/json

{
  "username": "admin",
  "recoveryCode": "ABC12345"
}
```

#### Response (200)

```json
{
  "success": true,
  "tempToken": "recovery-token-base64",
  "expiresIn": 900,
  "message": "Recovery code verified. Use this token to authenticate."
}
```

#### Errors

| Status | Error |
|--------|-------|
| 400 | Invalid recovery code format |
| 401 | Invalid or already used recovery code |
| 404 | No recovery codes found |

### POST /api/passkeys/recovery/disable

Disable all passkeys and recovery codes (emergency account recovery).

**Auth Required:** Yes (Bearer token)

#### Request

```http
POST /api/passkeys/recovery/disable
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "action": "disable"
}
```

#### Response (200)

```json
{
  "success": true,
  "message": "All passkeys and recovery codes disabled. Use password login."
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

System status and configuration check. Use this endpoint for monitoring and debugging deployment issues.

#### Usage

Monitor your LOON deployment's health:
```bash
# Basic health check
curl https://your-domain.com/api/health

# With pretty output
curl -s https://your-domain.com/api/health | jq .
```

#### Response (200)

```json
{
  "status": "ok",
  "timestamp": "2026-01-30T12:00:00Z",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```

#### Status Values

- `ok` - All required checks pass; system operational
- `degraded` - One or more required checks failed; see `checks` object

#### Check Details

| Check | Requirement | Failure Cause |
|-------|-------------|---------------|
| `github_repo` | `GITHUB_REPO` env var set | Missing or empty variable |
| `github_token` | `GITHUB_TOKEN` env var set | Missing token or invalid format |
| `kv_database` | KV namespace bound and accessible | KV binding misconfigured or no access |

#### Troubleshooting Failed Checks

**If `github_repo` is false**:
- Set `GITHUB_REPO` environment variable in Cloudflare Pages settings
- Format: `your-username/your-repo`
- Example: https://dash.cloudflare.com/your-account/pages/view/your-project/settings/environment-variables

**If `github_token` is false**:
- Generate a new token at https://github.com/settings/tokens
- Set as `GITHUB_TOKEN` environment variable (mark as Secret)
- Ensure token has `repo` scope

**If `kv_database` is false**:
- Verify KV namespace exists: Cloudflare > Workers & Pages > KV
- Verify binding: Your project > Settings > Functions > KV namespace bindings
- Binding variable name should be `LOON_DB` (preferred); `KV` is also accepted as a compatibility fallback

#### HTTP Status

- 200 - Healthy (`status: "ok"`)
- 503 - Degraded (`status: "degraded"`; see checks for details)

#### Monitoring Use Cases

**Uptime Monitoring**:
```bash
# Use in monitoring service (UptimeRobot, PagerDuty, etc.)
# Alert if endpoint returns 503 or doesn't respond within 30 seconds
```

**CI/CD Integration**:
```bash
#!/bin/bash
# Deploy wait script - don't proceed until health is "ok"
while [ "$(curl -s https://your-domain.com/api/health | jq -r .status)" != "ok" ]; do
  sleep 5
done
echo "System healthy - proceeding with tests"
```

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
