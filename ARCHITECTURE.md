# LOON Architecture (v3.1.0)

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
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                │
│                                                                         │
│  ┌─────────────────┐                    ┌─────────────────┐            │
│  │  Public Page    │                    │  Admin Editor   │            │
│  │  (index.html)   │                    │  (admin.html)   │            │
│  └────────┬────────┘                    └────────┬────────┘            │
│           │                                      │                      │
│           │ GET /data/.../content.json           │ POST /api/auth      │
│           │                                      │ POST /api/save      │
│           │                                      │ POST /api/publish   │
│           │                                      │ POST /api/upload    │
└───────────┼──────────────────────────────────────┼──────────────────────┘
            │                                      │
            ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PAGES                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Cloudflare Functions                          │   │
│  │  • /api/auth     → Session login/verify/logout/password         │   │
│  │  • /api/save     → Save with RBAC (draft/published)             │   │
│  │  • /api/publish  → Publish/unpublish                             │   │
│  │  • /api/upload   → Image upload                                  │   │
│  │  • /api/users    → User management (admin only)                  │   │
│  │  • /api/pages    → List/create pages                             │   │
│  │  • /api/sessions → Session management (admin only)               │   │
│  │  • /api/content  → Content deletion (admin/editor)               │   │
│  │  • /api/audit    → Audit log (admin only)                        │   │
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
│  data/{pageId}/content.json ◄── Updated with _meta + draft/published   │
└─────────────────────────────────────────────────────────────────────────┘
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

- Run on Cloudflare's edge network
- Handle authentication and authorization
- Commit content to GitHub via API
- Rate limited per IP address

### 3. Cloudflare KV (User + Session Store)

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
2. User enters Page ID and Password
3. Browser POSTs to /api/auth
4. Function validates password against USER_{PAGEID}_PASSWORD env var
5. On success, browser fetches schema.json and content.json
6. Editor form is generated from schema
7. User edits and clicks Save
8. Browser POSTs to /api/save with session token + content
9. Function validates session + RBAC
10. Function commits content.json to GitHub via API
11. GitHub webhook triggers Cloudflare Pages rebuild
12. ~60 seconds later, new content is live
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
| Credential theft | PBKDF2 with 100k iterations |

---

## File Structure

```
loon-skeleton/
│
├── Static Files (served by Cloudflare CDN)
│   ├── index.html          # Public page template
│   ├── admin.html          # Admin editor (unified)
│   ├── 404.html            # Custom error page
│   └── data/
│       └── {page_id}/
│           ├── schema.json  # Form field definitions
│           └── content.json # Actual content (edited by users)
│
├── Serverless Functions
│   └── functions/
│       └── api/
│           ├── auth.js      # Session login/logout/password change
│           ├── save.js      # Save with RBAC + drafts
│           ├── publish.js   # Publish/unpublish workflow
│           ├── upload.js    # Image uploads
│           ├── users.js     # User management
│           ├── pages.js     # List/create pages
│           ├── templates.js # Schema templates
│           ├── sessions.js  # Session management
│           ├── content.js   # Content deletion
│           ├── audit.js     # Audit log
│           └── health.js    # System status
│       └── lib/
│           └── schema-validator.js # JSON Schema utilities
│
├── Admin Scripts
│   └── scripts/
│       ├── bootstrap-admin.sh  # Create first admin
│       ├── bulk-users.sh       # Bulk user creation
│       ├── migrate-phase1-to-phase2.js # Phase 1 → Phase 2 migration
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
    ├── QA_TESTING_GUIDE.md # Comprehensive testing guide
    ├── CHANGELOG.md        # Version history
    └── docs/
        ├── API.md          # API reference
        ├── ONBOARDING.md   # User onboarding
        └── CUSTOMIZATION.md# Theming guide
```

---

## API Reference

LOON exposes the following API endpoints via Cloudflare Functions:

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/auth` | GET, POST, PATCH, DELETE | Authentication & sessions |
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

## Limitations

### Scalability

| Constraint | Limit |
|------------|-------|
| Users | Unlimited (KV) |
| Content size | 1 MB |
| Concurrent edits | "Last save wins" |

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
