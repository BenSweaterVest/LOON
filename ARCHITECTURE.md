# LOON Architecture

LOON is a serverless micro-CMS built on Cloudflare Pages + Cloudflare KV + GitHub.

## Overview

LOON separates responsibilities cleanly:
- Static frontend for public rendering and admin UI (`index.html`, `admin.html`)
- Cloudflare Functions for auth, RBAC, validation, and API orchestration
- Cloudflare KV for users, sessions, passkeys, audit, and operational state
- GitHub repository as auditable content source of truth (`data/<page>/...`)

## High-Level Flow

```text
Browser
  -> GET static assets/content from Cloudflare Pages CDN
  -> POST/GET /api/* to Cloudflare Functions

Cloudflare Functions
  -> read/write auth/session/audit state in KV
  -> read/write content files through GitHub API

GitHub
  -> stores schema/content JSON with commit history
  -> triggers Pages rebuild/deploy on change
```

## Authentication and Authorization

- Session auth with 24-hour tokens stored in KV.
- Optional WebAuthn passkeys and recovery-code flow.
- RBAC roles:
  - `admin`: full access
  - `editor`: content and workflow operations, no user admin
  - `contributor`: create/edit own content only

Contributor isolation is enforced against page ownership metadata (`_meta.createdBy`).

## Core Runtime Components

### Frontend
- `index.html`: public page renderer
- `admin.html`: admin/editor/contributor UI

### Functions API (`functions/api`)
- Auth/session: `auth.js`, `sessions.js`, `setup.js`
- Content lifecycle: `pages.js`, `save.js`, `publish.js`, `content.js`
- Revision/workflow: `history.js`, `rollback.js`, `revision-diff.js`, `workflow.js`, `scheduled-publish.js`
- Collaboration aids: `watch.js`, `blocks.js`
- Admin/ops: `users.js`, `audit.js`, `health.js`, `templates.js`, `upload.js`
- Shared helpers: `_cors.js`, `_response.js`, `_audit.js`, `_kv.js`, `_webauthn.js`, `_passkeys-schema.js`

### KV Data Patterns
- `user:<username>`
- `session:<token>` (TTL)
- `challenge:*` (TTL)
- `audit:*`
- rate-limit keys by endpoint and IP/user
- watchlist/passkey/recovery related keys

### Git Content Layout
- `data/<pageId>/schema.json`
- `data/<pageId>/content.json`
- optional reusable blocks at `data/_blocks/blocks.json`

## API Surface

Main endpoints:
- `/api/auth`, `/api/setup`, `/api/sessions`, `/api/users`
- `/api/pages`, `/api/save`, `/api/publish`, `/api/content`, `/api/templates`
- `/api/history`, `/api/rollback`, `/api/revision-diff`
- `/api/workflow`, `/api/scheduled-publish`
- `/api/watch`, `/api/blocks`
- `/api/upload`, `/api/audit`, `/api/health`
- passkeys endpoints under `/api/passkeys/*`

Canonical contract docs: `docs/API.md`.

## Security Model

- PBKDF2 password hashing with timing-safe comparison
- HTTPS via Cloudflare
- Input sanitization and bounded payload sizes
- KV-backed rate limiting on selected sensitive/write-heavy endpoints
- CORS policy configurable via `CORS_ORIGIN`
- Security headers defined in `_headers`

## Configuration

Required runtime variables:
- `GITHUB_REPO`
- `GITHUB_TOKEN`

Common production variables:
- `SETUP_TOKEN` (rotate/remove after first admin setup)
- `RP_ID`, `RP_ORIGIN` (for passkeys)
- `CF_ACCOUNT_ID`, `CF_IMAGES_TOKEN` (if image upload is enabled)

KV binding:
- preferred `LOON_DB`
- compatibility fallback `KV`

## Operational Characteristics

- Content writes are commit-based (auditable, eventually reflected after Pages deploy).
- Scheduled publish runner promotes due drafts to published state.
- Revision history, diff, and rollback are Git-backed.
- Admin workflows are designed to be browser-first for production operations.

## Known Trade-offs

- Last-write-wins semantics for concurrent edits.
- No real-time collaborative editing or merge UI.
- Publish latency depends on Pages build/deploy timing.
- GitHub API availability/rate limits directly affect content operations.
