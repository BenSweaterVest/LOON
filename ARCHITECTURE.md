# LOON Architecture
This document explains the technical architecture of Project LOON, a serverless micro-CMS.
## Table of Contents
1. [Overview](#overview)
2. [Authentication Model](#authentication-model)
3. [System Components](#system-components)
4. [Data Flow](#data-flow)
5. [Security Model](#security-model)
6. [File Structure](#file-structure)
7. [API Reference](#api-reference)
8. [Configuration](#configuration)
9. [Limitations](#limitations)
---
## Overview
LOON is built on a "Static Frontend, Serverless Gatekeeper" architecture with a unified KV-based authentication model.
---
## Authentication Model
- Users are stored in Cloudflare KV (`LOON_DB`)
- Session-based authentication (24h tokens)
- Role-based access control (Admin/Editor/Contributor)
**RBAC Permissions:**
| Role | Create | Edit Own | Edit Others | Manage Users |
|------|--------|----------|-------------|--------------|
| Admin | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes | No |
| Contributor | Yes | Yes | No | No |
### Architecture Diagram
```
+-------------------------------------------------------------------------+
�                           USER'S BROWSER                                �
�                                                                         �
�  +-----------------+                    +-----------------+            �
�  �  Public Page    �                    �  Admin Editor   �            �
�  �  (index.html)   �                    �  (admin.html)   �            �
�  +-----------------+                    +-----------------+            �
�           �                                      �                      �
�           � GET /data/.../content.json           � POST /api/auth      �
�           �                                      � POST /api/save      �
�           �                                      � POST /api/publish   �
�           �                                      � POST /api/upload    �
+-----------+--------------------------------------+----------------------+
            �                                      �
            ?                                      ?
+-------------------------------------------------------------------------+
�                        CLOUDFLARE PAGES                                 �
�                                                                         �
�  +-----------------------------------------------------------------+   �
�  �                    Cloudflare Functions                          �   �
�  �  � /api/auth     ? Session login/verify/logout/password         �   �
�  �  � /api/passkeys ? Passkey registration/auth/recovery (9 eps)   �   �
�  �  � /api/save     ? Save with RBAC (draft/published)             �   �
�  �  � /api/publish  ? Publish/unpublish                             �   �
�  �  � /api/upload   ? Image upload                                  �   �
�  �  � /api/users    ? User management (admin only)                  �   �
�  �  � /api/pages    ? List/create pages                             �   �
�  �  � /api/sessions ? Session management (admin only)               �   �
�  �  � /api/content  ? Content deletion (admin/editor)               �   �
�  �  � /api/audit    ? Audit log (admin only)                        �   �
�  +-----------------------------------------------------------------+   �
�                                 �                                       �
�  +-----------------------------------------------------------------+   �
�  �                    Cloudflare KV (LOON_DB)                       �   �
�  �  � user:{username}  ? {role, hash, salt, ...}                   �   �
�  �  � user:{username}:passkey:{credentialId} ? {publicKey, ...}   �   �
�  �  � user:{username}:recovery ? {codes[], salt, used[]}          �   �
�  �  � session:{token}  ? {username, role, created} [24h TTL]       �   �
�  �  � challenge:* ? {challenge, username, ...} [10min TTL]         �   �
�  +-----------------------------------------------------------------+   �
+-------------------------------------------------------------------------+
                                  �
                                  ? GitHub API
+-------------------------------------------------------------------------+
�                         GITHUB REPOSITORY                               �
�  data/{pageId}/content.json ?-- Updated with _meta + draft/published   �
+-------------------------------------------------------------------------+
```
---
## System Components
### 1. Static Frontend (HTML/JS)
**Files:** `index.html`, `admin.html`
- Pure HTML + vanilla JavaScript
- No build step required
- Served directly by Cloudflare Pages CDN
- `admin.html` - Unified editor (sessions, user management)
### 2. Cloudflare Functions (Serverless)
**Files:** `functions/api/*.js`
| File | Purpose |
|------|---------|
| `auth.js` | Session login/logout/password change |
| `passkeys.js` | Passkey registration/auth/recovery (9 endpoints) |
| `save.js` | Save with RBAC + drafts |
| `publish.js` | Publish/unpublish workflow |
| `upload.js` | Image uploads (Cloudflare Images) |
| `users.js` | User management (admin only) |
| `pages.js` | List/create pages |
| `templates.js` | List schema templates |
| `sessions.js` | Session management (admin only) |
| `content.js` | Content deletion (admin/editor) |
| `audit.js` | Audit log (admin only) |
| `health.js` | System status |
| `_cors.js` | Shared CORS utility |
| `_audit.js` | Shared audit logging |
| `_response.js` | Shared response formatting + error handling |
| `_webauthn.js` | WebAuthn crypto utilities |
| `_passkeys-schema.js` | Passkey KV schema helpers |
- Run on Cloudflare's edge network
- Handle authentication and authorization
- Commit content to GitHub via API
- Rate limited per IP address
### 3. Cloudflare KV (User + Session Store)
**Namespace:** `LOON_DB`
| Key Pattern | Value | TTL |
|-------------|-------|-----|
| `user:{username}` | `{role, hash, salt, created, ...}` | None |
| `user:{username}:passkey:{credentialId}` | `{id, publicKey, algorithm, transports, counter, ...}` | None |
| `user:{username}:passkey:index` | `[{id, name, created}, ...]` | None |
| `user:{username}:recovery` | `{codes: [hash1, hash2, ...], salt, used: [indices]}` | None |
| `session:{token}` | `{username, role, created, ip}` | 24 hours |
| `challenge:registration:{token}` | `{challenge, username, userId, created}` | 10 minutes |
| `challenge:auth:{token}` | `{challenge, created, usernameHint}` | 10 minutes |
| `recovery:auth:{token}` | `{username, recoveryCodeIndex, created}` | 15 minutes |
- Stores users and sessions
- Encrypted at rest
- Global replication
### 4. GitHub Repository (Content Storage)
- Stores all content as JSON files
- Provides version control (full history)
- Triggers Cloudflare Pages rebuild on commit
- Acts as the "source of truth"
### 5. Environment Variables (Secrets)
- Stored in Cloudflare Pages project settings
- Encrypted at rest
- Not exposed to client-side code
| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub API access |
| `GITHUB_REPO` | Target repository |
| `CF_ACCOUNT_ID` | Cloudflare Images account ID (optional) |
| `CF_IMAGES_TOKEN` | Cloudflare Images API token (optional) |
---
## Data Flow
### Reading Content (Public)
```
1. User visits https://site.pages.dev/
2. Browser loads index.html (static file)
3. JavaScript fetches /data/demo/content.json (static file)
4. JavaScript renders content in the page
```
**No serverless functions involved - pure static file serving.**
### Editing Content (Admin)
```
1. User visits https://site.pages.dev/admin.html
2. User enters Username and Password
3. Browser POSTs to /api/auth
4. Function validates password against KV user record (PBKDF2 hash)
5. On success, browser receives session token
6. Browser fetches schema.json and content.json
7. Editor form is generated from schema
8. User edits and clicks Save (as Draft or Direct)
9. Browser POSTs to /api/save with session token + content
10. Function validates session + RBAC
11. If draft: saves only to draft field
12. If direct (admin/editor): saves to both draft + published
13. Function commits content.json to GitHub via API
14. GitHub webhook triggers Cloudflare Pages rebuild
15. ~60 seconds later, content is live (if published)
```
---
## Security Model
### Authentication
| Layer | Implementation |
|-------|----------------|
| Password Storage | PBKDF2 hash in KV |
| Password Transmission | HTTPS (TLS 1.3) |
| Password Comparison | Timing-safe |
| Session Management | UUID tokens, 24h TTL |
| Brute Force Protection | 5 login/min |
### Authorization
| Check | Implementation |
|-------|----------------|
| Identity | Session token valid |
| Resource | Page ID + RBAC |
| Isolation | Role determines access |
### RBAC
| Role | Permissions |
|------|-------------|
| Admin | Edit any content, manage users |
| Editor | Edit any content |
| Contributor | Edit only own content (check `_meta.createdBy`) |
### Input Validation
| Input | Validation |
|-------|------------|
| Page ID | Alphanumeric + hyphens only, lowercase |
| Username | Alphanumeric + underscore/hyphen, 3-32 chars |
| Password | Minimum 8 characters |
| Recovery Code | 8 alphanumeric characters, uppercase |
| Credential ID | Base64url, 20-350 characters |
| Content | JSON only, max 1MB |

### Threat Mitigation

| Threat | Mitigation |
|--------|------------|
| Timing attacks | Constant-time comparison |
| Brute force | Rate limiting per IP |
| Path traversal | Page ID sanitization |
| XSS | Content stored as JSON, escaped on render |
| CSRF | Password/token required for each save |
| Session hijacking | Tokens expire after 24h, IP logged |
| Credential theft | PBKDF2 with 100k iterations |
| Phishing attacks | WebAuthn passkeys (phishing-resistant) |
| Cloned devices | Counter validation (passkeys) |
| Recovery code reuse | One-time use, hashed with PBKDF2 |
---
## File Structure
```
loon/
�
+-- Static Files (served by Cloudflare CDN)
�   +-- index.html          # Public page template
�   +-- admin.html          # Admin editor (unified)
�   +-- 404.html            # Custom error page
�   +-- data/
�       +-- {page_id}/
�           +-- schema.json  # Form field definitions
�           +-- content.json # Actual content (edited by users)
�
+-- Serverless Functions
�   +-- functions/
�       +-- api/
�           +-- auth.js      # Session login/logout/password change
�           +-- passkeys.js  # Passkey registration/auth/recovery (9 endpoints)
�           +-- save.js      # Save with RBAC + drafts
�           +-- publish.js   # Publish/unpublish workflow
�           +-- upload.js    # Image uploads
�           +-- users.js     # User management
�           +-- pages.js     # List/create pages
�           +-- templates.js # Schema templates
�           +-- sessions.js  # Session management
�           +-- content.js   # Content deletion
�           +-- audit.js     # Audit log
�           +-- health.js    # System status
�           +-- _webauthn.js # WebAuthn crypto utilities
�           +-- _passkeys-schema.js # Passkey KV schema helpers
�           +-- _cors.js     # Shared CORS utility
�           +-- _audit.js    # Shared audit logging
�       +-- lib/
�           +-- schema-validator.js # JSON Schema utilities
�
+-- Admin Scripts
�   +-- scripts/
�       +-- bootstrap-admin.sh  # Create first admin
�       +-- bulk-users.sh       # Bulk user creation
�       +-- backup-content.sh   # Export content backup
�       +-- restore-content.sh  # Restore from backup
�
+-- Examples (16 schemas)
�   +-- examples/
�       +-- food-truck/     # Food truck status
�       +-- blog-post/      # Blog articles
�       +-- event/          # Events and meetups
�       +-- ...             # See examples/README.md
�
+-- Documentation
    +-- README.md           # Quick start
    +-- ARCHITECTURE.md     # This file
    +-- CONTRIBUTING.md     # Development + testing
    +-- OPERATIONS.md       # Admin operations
    +-- SECURITY.md         # Security policy
    +-- docs/
        +-- API.md          # API reference
        +-- PASSKEYS_GUIDE.md # Passkey user guide
```
---
## API Reference
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
| `/api/save` | POST | Save content (draft or direct) |
| `/api/publish` | POST | Publish/unpublish content |
| `/api/upload` | POST | Upload images (Cloudflare Images) |
| `/api/pages` | GET, POST | List and create pages |
| `/api/templates` | GET | List schema templates |
| `/api/users` | GET, POST, PATCH, DELETE | User management (admin) |
| `/api/sessions` | GET, DELETE | Session management (admin) |
| `/api/content` | DELETE | Delete content |
| `/api/audit` | GET | View audit logs (admin) |
| `/api/health` | GET | System status check |
See [docs/API.md](docs/API.md) for complete API documentation.
---
## Configuration
### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with repo write access |
| `GITHUB_REPO` | Yes | Repository in "owner/repo" format |
| `CF_ACCOUNT_ID` | No | Cloudflare Images account ID |
| `CF_IMAGES_TOKEN` | No | Cloudflare Images API token |
### KV Bindings
| Binding | Namespace | Description |
|---------|-----------|-------------|
| `LOON_DB` | LOON_DB | User and session storage |
### Rate Limits
| Endpoint | Limit | Window |
|----------|-------|--------|
| /api/auth | 5 requests | 1 minute |
| /api/save | 30 requests | 1 minute |
### Size Limits
| Resource | Limit |
|----------|-------|
| Content JSON | 1 MB |
| KV storage | 1 GB (free tier) |
---
## Core Features

### 1. Dual Authentication: Password + Passkeys
- **Password Auth**: PBKDF2 hashing (100,000 iterations), timing-safe comparison
- **Passkey Auth**: WebAuthn/FIDO2 support (Face ID, Touch ID, security keys)
- **Recovery Codes**: 12x backup codes for account recovery
- All accounts stored securely in Cloudflare KV with 24-hour session tokens and role-based access control

**Setup**:
1. Create KV namespace `LOON_DB` in Cloudflare
2. Bind to Pages project in Functions settings
3. Run bootstrap: `./scripts/bootstrap-admin.sh admin MyPassword`
4. Deploy

**Using Passkeys**:
1. Log in with password
2. Navigate to Settings ? Security ? Add Passkey
3. Follow browser prompts (Face ID, Touch ID, etc.)
4. Save recovery codes in secure location
5. Next login: Click "Login with Passkey"

### 2. Draft/Publish Workflow
Content stages before publishing to production. All content stored with `_meta` tracking status, creator, and timestamps.

**Permissions**:
| Role | Draft | Publish | Unpublish |
|------|-------|---------|-----------|
| Admin | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes |
| Contributor | Yes | No | No |

Public site displays only published content.

### 3. Image Upload & Management
Images stored in Cloudflare Images with URL-based delivery. Supports JPEG, PNG, GIF, WebP (10MB max).

**Setup** (optional):
```
CF_ACCOUNT_ID = your-account-id
CF_IMAGES_TOKEN = your-api-token
```

**Schema field type**: `image` (renders upload button and preview)

### 4. JSON Schema Support
Industry-standard JSON Schema (draft-07) for content validation and UI generation. Enables type checking, required fields, and pattern matching.

---
## Scaling & Performance

### Capacity Limits
| Metric | Limit | Notes |
|--------|-------|-------|
| Concurrent Users | Unlimited | Test beyond 100 |
| Content Pages | <1,000 | GitHub repo concerns |
| Content Per Page | 1 MB | Hard limit |
| Total Repo Size | 100 GB | GitHub soft limit |
| KV Storage | 1 GB | Free tier |
| Concurrent Editors | <10 | Conflict risk increases |

### Deployment Profiles

**Small** (<10 users): Default setup, 5-20 pages, <50 edits/day  
**Medium** (10-100 users): Monitor GitHub rate limits, daily backups, 50-500 pages  
**Large** (>100 users): Request GitHub rate limit increase, archive old pages, 500-5,000 pages, implement usage limits

### Performance
| Operation | Time | Notes |
|-----------|------|-------|
| Login | 500-2,000ms | PBKDF2 hashing is slow by design |
| Page Load | 200-1,000ms | Varies with Cloudflare edge location |
| Save | 2,000-15,000ms | Includes GitHub API call + retry logic |

---
## Limitations
### Features Not Included
- Real-time collaboration
- Content versioning UI (use GitHub history)
- Full-text search
- User self-registration
- Password reset (self-service)
- Two-factor authentication
### Known Trade-offs
| Trade-off | Reason |
|-----------|--------|
| In-memory rate limiting | Simplicity; KV would add latency |
| ~60s deploy delay | Static site generation model |
| No real-time sync | Serverless architecture |
| Last-save-wins | Avoids complex merge logic |

See README.md for upcoming features in development.
