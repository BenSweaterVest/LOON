# LOON Architecture (v2.0.0)

This document explains the technical architecture of Project LOON, a serverless micro-CMS.

## Table of Contents

1. [Overview](#overview)
2. [Operating Modes](#operating-modes)
3. [System Components](#system-components)
4. [Data Flow](#data-flow)
5. [Security Model](#security-model)
6. [File Structure](#file-structure)
7. [API Reference](#api-reference)
8. [Configuration](#configuration)
9. [Limitations](#limitations)

---

## Overview

LOON is built on a "Static Frontend, Serverless Gatekeeper" architecture. It supports two operating modes:

| Mode | Auth Storage | Users | Use Case |
|------|--------------|-------|----------|
| **Phase 1: Directory** | Environment Variables | ~95 max | Independent users (food trucks, vendors) |
| **Phase 2: Team** | Cloudflare KV | Unlimited | Hierarchical teams with RBAC |

---

## Operating Modes

### Phase 1: Directory Mode

- One password per page (stored as env var)
- Each user edits only their assigned page
- Simple setup, no database needed
- Best for: directories, vendor listings, independent operators

### Phase 2: Team Mode

- Users stored in Cloudflare KV database
- Session-based authentication (24h tokens)
- Role-based access control (Admin/Editor/Contributor)
- Best for: newsrooms, teams, companies

**RBAC Permissions:**

| Role | Create | Edit Own | Edit Others | Manage Users |
|------|--------|----------|-------------|--------------|
| Admin | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes | No |
| Contributor | Yes | Yes | No | No |

### Architecture Diagram (Phase 1)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                │
│                                                                         │
│  ┌─────────────────┐                    ┌─────────────────┐            │
│  │  Public Page    │                    │  Admin Editor   │            │
│  │  (index.html)   │                    │  (admin.html)   │            │
│  └────────┬────────┘                    └────────┬────────┘            │
│           │                                      │                      │
│           │ GET /data/demo/content.json          │ POST /api/auth      │
│           │                                      │ POST /api/save      │
└───────────┼──────────────────────────────────────┼──────────────────────┘
            │                                      │
            ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PAGES                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Static Files                                │   │
│  │  • index.html, admin.html (served directly)                     │   │
│  │  • data/*/content.json (served directly)                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Cloudflare Functions                          │   │
│  │  • /api/auth    → Validates password vs env var                 │   │
│  │  • /api/save    → Commits to GitHub                             │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Environment Variables                         │   │
│  │  • GITHUB_TOKEN, GITHUB_REPO                                    │   │
│  │  • USER_{PAGEID}_PASSWORD (per page)                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ GitHub API
┌─────────────────────────────────────────────────────────────────────────┐
│                         GITHUB REPOSITORY                               │
│  data/{pageId}/content.json ◄── Updated by /api/save                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Architecture Diagram (Phase 2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                │
│                                                                         │
│  ┌─────────────────┐                    ┌─────────────────┐            │
│  │  Public Page    │                    │  Team Admin     │            │
│  │  (index.html)   │                    │  (admin-v2.html)│            │
│  └────────┬────────┘                    └────────┬────────┘            │
│           │                                      │                      │
│           │ GET /data/.../content.json           │ POST /api/auth-v2   │
│           │                                      │ POST /api/save-v2   │
│           │                                      │ /api/users (admin)  │
└───────────┼──────────────────────────────────────┼──────────────────────┘
            │                                      │
            ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PAGES                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Cloudflare Functions                          │   │
│  │  • /api/auth-v2  → Session login/verify/logout/password         │   │
│  │  • /api/save-v2  → Save with RBAC (requires token)              │   │
│  │  • /api/users    → User management (admin only)                 │   │
│  │  • /api/pages    → List available pages (RBAC filtered)         │   │
│  │  • /api/sessions → Session management (admin only)              │   │
│  │  • /api/content  → Content deletion (admin/editor)              │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Cloudflare KV (LOON_DB)                       │   │
│  │  • user:{username}  → {role, hash, salt, ...}                   │   │
│  │  • session:{token}  → {username, role, created} [24h TTL]       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ GitHub API
┌─────────────────────────────────────────────────────────────────────────┐
│                         GITHUB REPOSITORY                               │
│  data/{pageId}/content.json ◄── Updated with _meta (createdBy, etc.)   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## System Components

### 1. Static Frontend (HTML/JS)

**Files:** `index.html`, `admin.html`, `admin-v2.html`

- Pure HTML + vanilla JavaScript
- No build step required
- Served directly by Cloudflare Pages CDN
- `admin.html` - Phase 1 editor (password per page)
- `admin-v2.html` - Phase 2 editor (sessions, user management)

### 2. Cloudflare Functions (Serverless)

**Files:** `functions/api/*.js`

| File | Phase | Purpose |
|------|-------|---------|
| `auth.js` | 1 | Password validation (env vars) |
| `auth-v2.js` | 2 | Session login/logout (KV) |
| `save.js` | 1 | Save with password |
| `save-v2.js` | 2 | Save with RBAC |
| `users.js` | 2 | User management (admin only) |
| `health.js` | Both | System status |

- Run on Cloudflare's edge network
- Handle authentication and authorization
- Commit content to GitHub via API
- Rate limited per IP address

### 3. Cloudflare KV (Phase 2 Database)

**Namespace:** `LOON_DB`

| Key Pattern | Value | TTL |
|-------------|-------|-----|
| `user:{username}` | `{role, hash, salt, created, ...}` | None |
| `session:{token}` | `{username, role, created, ip}` | 24 hours |

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

| Variable | Phase | Purpose |
|----------|-------|---------|
| `GITHUB_TOKEN` | Both | GitHub API access |
| `GITHUB_REPO` | Both | Target repository |
| `USER_{PAGEID}_PASSWORD` | 1 | Per-page passwords |

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
2. User enters Page ID and Password
3. Browser POSTs to /api/auth
4. Function validates password against USER_{PAGEID}_PASSWORD env var
5. On success, browser fetches schema.json and content.json
6. Editor form is generated from schema
7. User edits and clicks Save
8. Browser POSTs to /api/save with password + content
9. Function validates password again
10. Function commits content.json to GitHub via API
11. GitHub webhook triggers Cloudflare Pages rebuild
12. ~60 seconds later, new content is live
```

---

## Security Model

### Authentication

| Layer | Phase 1 | Phase 2 |
|-------|---------|---------|
| Password Storage | Encrypted env vars | PBKDF2 hash in KV |
| Password Transmission | HTTPS (TLS 1.3) | HTTPS (TLS 1.3) |
| Password Comparison | Timing-safe | Timing-safe |
| Session Management | N/A (per-request) | UUID tokens, 24h TTL |
| Brute Force Protection | 10 auth/min | 5 login/min |

### Authorization

| Check | Phase 1 | Phase 2 |
|-------|---------|---------|
| Identity | Password matches env var | Session token valid |
| Resource | Page ID determines file | Page ID + RBAC |
| Isolation | Each page isolated | Role determines access |

### Phase 2 RBAC

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
| Content | JSON only, max 1MB |

### Threat Mitigation

| Threat | Mitigation |
|--------|------------|
| Timing attacks | Constant-time comparison (both phases) |
| Brute force | Rate limiting per IP |
| Path traversal | Page ID sanitization |
| XSS | Content stored as JSON, escaped on render |
| CSRF | Password/token required for each save |
| Session hijacking | Tokens expire after 24h, IP logged |
| Credential theft | PBKDF2 with 100k iterations (Phase 2) |

---

## File Structure

```
loon-skeleton/
│
├── Static Files (served by Cloudflare CDN)
│   ├── index.html          # Public page template
│   ├── admin.html          # Phase 1 editor
│   ├── admin-v2.html       # Phase 2 editor (Team Mode)
│   ├── 404.html            # Custom error page
│   └── data/
│       └── {page_id}/
│           ├── schema.json  # Form field definitions
│           └── content.json # Actual content (edited by users)
│
├── Serverless Functions
│   └── functions/
│       └── api/
│           ├── auth.js      # Phase 1: Password validation
│           ├── auth-v2.js   # Phase 2: Session login/logout
│           ├── save.js      # Phase 1: Save with password
│           ├── save-v2.js   # Phase 2: Save with RBAC
│           ├── users.js     # Phase 2: User management
│           └── health.js    # System status
│
├── Admin Scripts
│   └── scripts/
│       ├── manage-users.sh     # Phase 1: CLI user management
│       ├── bootstrap-admin.sh  # Phase 2: Create first admin
│       ├── backup-content.sh   # Export content backup
│       └── restore-content.sh  # Restore from backup
│
├── Examples (16 schemas)
│   └── examples/
│       ├── food-truck/     # Food truck status
│       ├── blog-post/      # Blog articles
│       ├── event/          # Events and meetups
│       └── ...             # See examples/README.md
│
└── Documentation
    ├── README.md           # Quick start guide
    ├── ARCHITECTURE.md     # This file
    ├── SECURITY.md         # Security policy
    ├── TROUBLESHOOTING.md  # Common issues
    ├── USER-GUIDE.md       # For content editors
    ├── CHANGELOG.md        # Version history
    └── docs/
        ├── API.md          # API reference
        ├── PHASE2-SETUP.md # Team Mode setup
        ├── OPERATIONS.md   # Day-to-day ops
        ├── ONBOARDING.md   # User onboarding
        ├── CUSTOMIZATION.md# Theming guide
        └── TESTING.md      # Test checklist
```

---

## API Reference

### Phase 1 Endpoints

#### POST /api/auth

Validates page credentials (password per page).

**Request:**
```json
{
  "pageId": "demo",
  "password": "secret123"
}
```

**Response:** `{"success": true, "pageId": "demo"}`

#### POST /api/save

Saves content with password authentication.

**Request:**
```json
{
  "pageId": "demo",
  "password": "secret123",
  "content": { "headline": "Hello", "body": "World" }
}
```

**Response:** `{"success": true, "commit": "abc123..."}`

### Phase 2 Endpoints

#### POST /api/auth-v2

Login and get session token.

**Request:**
```json
{
  "username": "admin",
  "password": "secret123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "uuid-here",
  "role": "admin",
  "username": "admin",
  "expiresIn": 86400
}
```

#### GET /api/auth-v2

Verify session token is valid.

**Headers:** `Authorization: Bearer {token}`

**Response:** `{"valid": true, "username": "admin", "role": "admin", "expiresIn": 43200}`

#### PATCH /api/auth-v2

Change own password.

**Headers:** `Authorization: Bearer {token}`

**Request:** `{"currentPassword": "old", "newPassword": "new"}`

**Response:** `{"success": true, "message": "Password changed successfully"}`

#### DELETE /api/auth-v2

Logout and invalidate session.

**Headers:** `Authorization: Bearer {token}`

**Response:** `{"success": true, "message": "Logged out"}`

#### POST /api/save-v2

Save content with session and RBAC.

**Headers:** `Authorization: Bearer {token}`

**Request:**
```json
{
  "pageId": "demo",
  "content": { "headline": "Hello", "body": "World" }
}
```

**Response:**
```json
{
  "success": true,
  "commit": "abc123...",
  "pageId": "demo",
  "modifiedBy": "admin"
}
```

#### /api/users (Admin Only)

**Headers:** `Authorization: Bearer {admin-token}`

| Method | Action | Body |
|--------|--------|------|
| GET | List users | - |
| POST | Create user | `{username, role, password?}` |
| PATCH | Update/reset | `{username, role?, resetPassword?}` |
| DELETE | Remove user | `{username}` |

#### GET /api/pages

List available pages. Supports RBAC filtering (contributors see only their pages).

**Headers:** `Authorization: Bearer {token}` (optional)

**Response:** `{"pages": [...], "mode": "team", "canEditAll": true, "total": 5}`

#### /api/sessions (Admin Only)

**Headers:** `Authorization: Bearer {admin-token}`

| Method | Action | Body |
|--------|--------|------|
| GET | List active sessions | - |
| DELETE | Revoke sessions | `{username, all: true}` |

#### DELETE /api/content (Admin/Editor)

Delete page content.

**Headers:** `Authorization: Bearer {token}`

**Request:** `{"pageId": "page-to-delete"}`

**Response:** `{"success": true, "message": "Content deleted", "commit": "sha..."}`

### GET /api/health

Returns system health status.

**Response:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "mode": "team",
  "timestamp": "2026-01-30T12:00:00.000Z",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```

See [docs/API.md](docs/API.md) for complete API documentation.

---

## Configuration

### Environment Variables

| Variable | Phase | Required | Description |
|----------|-------|----------|-------------|
| `GITHUB_TOKEN` | Both | Yes | GitHub PAT with repo write access |
| `GITHUB_REPO` | Both | Yes | Repository in "owner/repo" format |
| `USER_{PAGEID}_PASSWORD` | 1 | Per page | Password for each page |

### KV Bindings (Phase 2)

| Binding | Namespace | Description |
|---------|-----------|-------------|
| `LOON_DB` | LOON_DB | User and session storage |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| /api/auth | 10 requests | 1 minute |
| /api/auth-v2 | 5 requests | 1 minute |
| /api/save | 30 requests | 1 minute |
| /api/save-v2 | 30 requests | 1 minute |

### Size Limits

| Resource | Limit |
|----------|-------|
| Content JSON | 1 MB |
| Environment variables | ~100 per project |
| KV storage | 1 GB (free tier) |

---

## Limitations

### Scalability

| Constraint | Phase 1 Limit | Phase 2 Limit |
|------------|---------------|---------------|
| Users | ~95 (env vars) | Unlimited (KV) |
| Content size | 1 MB | 1 MB |
| Concurrent edits | "Last save wins" | "Last save wins" |

### Features Not Included

- Real-time collaboration
- Content versioning UI (use GitHub)
- Media uploads (link to external URLs)
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

---

## Future Enhancements

See [CHANGELOG.md](CHANGELOG.md) for the roadmap.

### Planned (v2.1.0)
- Admin UI for user management (web interface)
- Audit logging for content changes
- Password complexity requirements

### Future (v3.0.0)
- Two-factor authentication for admin accounts
- Content approval workflows
- Scheduled publishing
- Multi-site management
