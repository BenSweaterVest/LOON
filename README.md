# Project LOON
**L**ightweight **O**nline **O**rganizing **N**etwork
A serverless micro-CMS that runs entirely on Cloudflare Pages + GitHub. No traditional database, no servers, $0/month.
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-available-brightgreen.svg)](docs/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#testing)

**New to LOON?** Start with [Install (Recommended)](#install-recommended).  
**Working on LOON itself?** Use [CONTRIBUTING.md](CONTRIBUTING.md).

**Core Features**: Password and passkey authentication, Git-based content, schema validation. For a quick overview of recent updates, see [CHANGELOG.md](CHANGELOG.md).

---
## Features
- **Zero Cost**: Runs entirely on Cloudflare + GitHub free tiers
- **No Database Server**: Content stored as JSON files in Git
- **User Management**: Cloudflare KV for unlimited users
- **Role-Based Access**: Admin, Editor, and Contributor roles
- **Draft/Publish Workflow**: Stage content before going live
- **Session Batch Push**: Stage many edits and push all changes at once
- **Auto-Staging in Batch Mode**: Changes can stage in background while you type
- **Media Management**: Upload images via Cloudflare Images
- **JSON Schema Support**: Standards-based schema validation
- **Two-Column Editor Layout**: Clear content canvas + right-side publish/workflow panels
- **WYSIWYG Editor**: Dynamic forms generated from schema
- **Import Support**: Import `.json`, `.tid`, `.md`, `.txt`, `.html` into page fields
- **Theme Support**: Switch admin theme in-app (Slate, Forest, Sunset)
- **Revision History + Rollback**: Restore a page to a prior commit from admin
- **Revision Diff**: Compare the latest two revisions directly in admin
- **Autosave Recovery**: Recover local editor snapshots after refresh/interruption
- **Internal Link Tools**: Insert page links and scan backlinks
- **Workflow Statuses**: Track `draft`, `in_review`, `approved`, `scheduled`, `published`
- **Scheduled Publish Runner**: Publish all due scheduled pages with one admin action
- **Watchlists**: Watch pages and view recent watched-page activity
- **Reusable Blocks**: Insert shared content snippets from defaults or `data/_blocks/blocks.json`
- **Mobile-Friendly**: Works on phones and tablets
- **Dark Mode**: Respects system preference automatically
- **Audit Logging**: Track all actions in the system
- **Secure**: PBKDF2 hashing, timing-safe auth, WebAuthn/FIDO2 passkeys (ES256 signatures verified; attestation chain not verified), rate limiting
- **Auditable**: Full Git history of all changes
---
## Install (Recommended)
Use this path for the simplest successful setup with the fewest manual decisions.

Browser-only requirement:
- Every required setup step below can be completed from:
  - GitHub web UI
  - Cloudflare dashboard
  - LOON admin UI
- No terminal/CLI is required for production setup.

### 1. Create Repo + Pages Project
1. Use this repo as a GitHub template.
2. In Cloudflare Dashboard, create a Pages project from that repo.
3. Build settings:
   - Framework preset: None
   - Build command: *(leave empty)*
   - Build output directory: *(leave empty)*

### 2. Configure KV Binding
1. Create KV namespace `LOON_DB` in Cloudflare.
2. In your Pages project settings, add binding `LOON_DB` -> namespace `LOON_DB`.
3. Redeploy.

Notes:
- Preferred binding name is `LOON_DB`.
- Runtime compatibility fallback: `KV` is also accepted.
- If Cloudflare shows "Bindings for this project are being managed through wrangler.toml", remove KV blocks from `wrangler.toml` (or remove that file), redeploy, then add the binding in dashboard.

### KV Best Practice (What Automates vs What Does Not)
- Browser-only production setup (recommended): create and bind KV in Cloudflare Dashboard once per Pages project.
- Local CLI automation (`npm run setup:kv`): optional developer convenience for local `wrangler.local.toml` only.
- Each Cloudflare account/project still needs its own production KV namespace and binding in dashboard.

### 3. Configure Environment Variables (Production)
In Cloudflare Pages > Settings > Environment variables:

| Variable | Value |
|----------|-------|
| `GITHUB_REPO` | `YOUR_GITHUB_ORG/LOON` |
| `GITHUB_TOKEN` | Fine-grained token with repo Contents read/write (Secret) |
| `SETUP_TOKEN` | High-entropy one-time setup token (Secret) |
| `RP_ID` | Your deployed host (e.g., `your-project.pages.dev` or `cms.example.com`) |
| `RP_ORIGIN` | Full origin for that host (e.g., `https://your-project.pages.dev`) |

Important:
- `GITHUB_REPO` must be explicitly set (not reliably auto-detected at runtime).
- `SETUP_TOKEN` is only for first-admin setup.
- Passkeys are optional. If you want passkeys in production, set `RP_ID` + `RP_ORIGIN`.

### 4. Deploy and Run Initial Setup
1. Deploy (or redeploy after adding env vars and KV binding).
2. Open `https://YOUR_PROJECT.pages.dev/admin.html`.
3. Complete the Initial Setup form:
   - Setup Token = `SETUP_TOKEN`
   - Admin Username + Admin Password = your real login credentials

Security note:
- Admin password is hashed before storage.
- Rotate or remove `SETUP_TOKEN` after first admin is created.

### 5. Verify
1. Check health: `https://YOUR_PROJECT.pages.dev/api/health` and confirm `kv_database: true`.
2. If using passkeys, also confirm `passkeys_ready: true` (or both `passkeys_rp_id` and `passkeys_rp_origin` are `true`).
3. Log in to `/admin.html`.
4. Create a page and save once to confirm GitHub commits are working.

### Guided Browser-Only Implementation Checklist
Use this if you want an exact click path with no CLI.

1. GitHub (template + repo)
   - Click **Use this template** on the LOON repository.
   - Create your new repository and confirm files appear on the main branch.
2. Cloudflare Pages (project + deploy)
   - Go to **Workers & Pages -> Create -> Pages -> Connect to Git**.
   - Select your LOON repo and deploy with default LOON settings (no build command).
3. Cloudflare KV binding
   - Go to **Workers & Pages -> KV** and create namespace `LOON_DB`.
   - Go to your Pages project -> **Settings -> Bindings -> KV namespace bindings**.
   - Add binding name `LOON_DB` to namespace `LOON_DB`.
   - If bindings are grayed out with Wrangler-managed message:
     - Remove KV binding blocks from root `wrangler.toml` (or remove that file).
     - Commit and redeploy.
     - Return to **Settings -> Bindings** and add `LOON_DB`.
4. Cloudflare environment variables
   - Go to Pages project -> **Settings -> Environment variables -> Production**.
   - Add:
     - `GITHUB_REPO=owner/repo`
     - `GITHUB_TOKEN=<fine-grained token>` as Secret
     - `SETUP_TOKEN=<high-entropy value>` as Secret
     - `RP_ID=<your-hostname>` (for passkeys)
     - `RP_ORIGIN=https://<your-hostname>` (for passkeys)
   - Redeploy from **Deployments -> Retry deployment**.
5. LOON guided setup page
   - Open `/admin.html`.
   - Review the **Guided Setup Assistant** status card.
   - If checks are not ready, fix Cloudflare settings and click **Refresh Checks**.
   - Click **Run Full Readiness Check** to validate setup/login/content-read path.
   - When ready, complete **Initial Setup** with Setup Token + admin credentials.
   - After login, use **Start First Page Wizard** to create and save your first page.
   - Optional: enable **Batch Session Mode** in the editor to stage multiple edits and click **Push All Changes** once.
   - Optional: use **Import File** in the editor to load `.json`, `.tid`, markdown, text, or HTML content into current schema fields.
   - Optional diagnostics-only screen: `/admin/setup-check` (browser-only readiness view).
6. Finalize security
   - After successful first admin creation, rotate/remove `SETUP_TOKEN` in Cloudflare.
   - Confirm `/api/health` returns all required checks as `true`.

### Optional: Local CLI Automation (Developer Convenience Only)
This is optional and not required for browser-only setup:

```bash
# Create/update local KV bindings in wrangler.local.toml (LOON_DB + KV alias)
npm run setup:kv

# Validate env/config locally
npm run check:env

# Do both in one command
npm run setup:local
```

### Manual Upstream Updates (Template-Based Repos)
If your site repo was created from the LOON template (for example `BenSweaterVest/CapitolFoodTrucksLOON` from `BenSweaterVest/LOON`), there is no one-click "Sync fork" button. Template repos are independent repositories.

Recommended manual update flow:
1. In your site repo, create branch `chore/sync-loon-YYYYMMDD`.
2. Add upstream remote and fetch latest LOON:

```bash
git remote add upstream https://github.com/BenSweaterVest/LOON.git
git fetch upstream
```

3. Merge upstream into your branch:

```bash
git checkout chore/sync-loon-YYYYMMDD
git merge upstream/main --allow-unrelated-histories
```

4. Resolve conflicts, keeping instance-specific values:
- `data/*` content files
- branding/custom text
- Cloudflare project/domain/env differences

5. Validate before merge:

```bash
npm ci
npm run lint
npm test
```

6. Open PR to your `main`, merge, redeploy, then run smoke checks:
- `/api/health` returns `status: "ok"`
- admin login works
- save one test edit successfully
- publish/rollback still work for a test page

### Auth State Backup (KV)
Content in `data/` is already Git-backed. Authentication/session/passkey state lives in Cloudflare KV and should be backed up separately.

Included options:
- Scheduled GitHub Action: `.github/workflows/backup-kv.yml`
- Manual CLI backup: `npm run backup:kv`
- Manual CLI restore: `npm run restore:kv -- backups/<file>.json`

Required secrets/env for KV backup/restore:
- `CF_API_TOKEN` (KV read/write permission)
- `CF_ACCOUNT_ID`
- `KV_NAMESPACE_ID`

Recommended:
1. Configure the 3 secrets in GitHub repo settings.
2. Run backup workflow manually once (`Actions -> Backup KV State -> Run workflow`) to validate.
3. Keep at least one recent KV backup before major updates.
---
## Production Checklist
Before going live, confirm these are set and working:
- KV binding: `LOON_DB` is configured (`KV` also works as compatibility fallback)
- Environment: `GITHUB_REPO` and `GITHUB_TOKEN` configured (secret)
- Recovery: KV backup workflow configured (or manual `npm run backup:kv` process documented)
- CORS: `CORS_ORIGIN` set to your production domain (if restricting)
- Passkeys: `RP_ID` and `RP_ORIGIN` set to your production domain
- Health check: `/api/health` returns `kv_database: true` and, for passkeys, `passkeys_ready: true`

---
## File Structure
```
loon/
+-- index.html              # Public page (renders JSON content)
+-- admin.html              # Admin panel (login, edit, manage users)
+-- admin/
   +-- setup-check/
      +-- index.html       # Browser-only setup diagnostics entry point
+-- 404.html                # Custom error page
+-- robots.txt              # Search engine directives
+-- _headers                # Cloudflare Pages security headers
+-- wrangler.dev.toml       # Local development Wrangler config
+-- wrangler.local.toml     # Local-only KV bindings (generated, gitignored)
+-- package.json            # Node.js config (dev dependencies, scripts)
+-- vitest.config.js        # Test configuration
+-- .env.example            # Environment variable template
+-- functions/
   +-- api/
   |   +-- _cors.js        # Shared CORS utility (configurable origin)
   |   +-- _audit.js       # Audit logging utility
   |   +-- _response.js    # Shared response formatting + error handling
   |   +-- _webauthn.js    # WebAuthn crypto utilities
   |   +-- _passkeys-schema.js  # Passkey KV schema helpers
   |   +-- auth.js         # /api/auth - session auth + password change
   |   +-- save.js         # /api/save - content save with RBAC + drafts
   |   +-- publish.js      # /api/publish - publish/unpublish workflow
   |   +-- history.js      # /api/history - revision history for content
   |   +-- rollback.js     # /api/rollback - restore content to prior commit
   |   +-- revision-diff.js # /api/revision-diff - compare two revisions
   |   +-- workflow.js     # /api/workflow - editorial workflow status updates
   |   +-- scheduled-publish.js # /api/scheduled-publish - publish due scheduled drafts
   |   +-- watch.js        # /api/watch - user watchlist and watched activity
   |   +-- blocks.js       # /api/blocks - reusable editor snippets
   |   +-- upload.js       # /api/upload - image upload (Cloudflare Images)
   |   +-- users.js        # /api/users - user management (admin)
   |   +-- pages.js        # /api/pages - list and create pages
   |   +-- templates.js    # /api/templates - list schema templates
   |   +-- sessions.js     # /api/sessions - session management (admin)
   |   +-- content.js      # /api/content - content deletion
   |   +-- audit.js        # /api/audit - view audit logs (admin)
   |   +-- setup.js        # /api/setup - one-time first-admin setup
   |   +-- health.js       # /api/health - system status
   +-- lib/
      +-- schema-validator.js # JSON Schema conversion + validation
+-- tests/
   +-- helpers.js          # Test utilities (mock request, env, KV)
   +-- auth.test.js        # Auth endpoint tests
   +-- content.test.js     # Content deletion endpoint tests
   +-- health.test.js      # Health endpoint tests
   +-- history.test.js     # Revision history endpoint tests
   +-- kv-util.test.js     # KV utility tests
   +-- kv-fallback.test.js # KV fallback compatibility tests
   +-- pages.test.js       # Pages endpoint tests
   +-- publish.test.js     # Publish/unpublish endpoint tests
   +-- save.test.js        # Save endpoint tests
   +-- setup.test.js       # Initial setup endpoint tests
   +-- schemas.test.js     # Schema validation tests
   +-- templates.test.js   # Templates endpoint tests
   +-- upload.test.js      # Upload endpoint tests
   +-- webauthn.test.js    # WebAuthn utility tests
   +-- passkeys.test.js    # Passkeys flow and schema tests
   +-- rollback.test.js    # Rollback endpoint tests
   +-- revision-diff.test.js # Revision diff endpoint tests
   +-- scheduled-publish.test.js # Scheduled publish runner tests
   +-- workflow.test.js    # Workflow status endpoint tests
   +-- watch.test.js       # Watchlist endpoint tests
   +-- blocks.test.js      # Reusable blocks endpoint tests
+-- data/
   +-- demo/
      +-- schema.json     # Form field definitions
      +-- content.json    # Actual content (edited by users)
+-- examples/               # 16 ready-to-use schemas
   +-- ...                 # (see examples/README.md)
+-- scripts/
   +-- backup-kv.mjs       # Cloudflare KV snapshot backup
   +-- restore-kv.mjs      # Cloudflare KV restore from backup file
   +-- bootstrap-admin.js  # Legacy admin bootstrap helper
   +-- setup-kv.mjs        # Optional KV automation (Wrangler)
   +-- check-env.mjs       # Local environment/config validation
   +-- setup-admin.mjs     # Optional CLI admin bootstrap (Wrangler)
   +-- validate-json.mjs   # JSON validation script
+-- CONTRIBUTING.md         # Development guidelines + testing
+-- LICENSE                 # MIT License
+-- OPERATIONS.md           # Admin operations + troubleshooting
+-- README.md               # This file
+-- SECURITY.md             # Security policy
```
---
## Roles and Permissions
| Role | Create Pages | Edit Own | Edit Others | Manage Users | View Audit |
|------|--------------|----------|-------------|--------------|------------|
| **Admin** | Yes | Yes | Yes | Yes | Yes |
| **Editor** | Yes | Yes | Yes | No | No |
| **Contributor** | No | Yes | No | No | No |
---
## Adding Pages
### Option A: Admin Panel (Recommended - Easiest!)
1. Log in to `/admin.html`
2. Click **"+ Create Page"** button
3. Enter a **Page ID** (lowercase, alphanumeric + hyphens only)
4. Select a **Template** or start with a blank schema
5. Click **Create Page**
6. The new page appears in your admin panel and is ready to edit
7. Optional: click **Import File** in the editor to prefill fields from `.json`, `.tid`, `.md`, `.txt`, or `.html`
8. Optional: enable **Batch Session Mode** and use **Push All Changes** to commit staged edits together
9. Use the **Formatting + Media** toolbar above the content form for bold/italic/headings/lists, links, and inline image insertion
10. If staged edits exist for the page, push them first before publishing

### Editing Workflow (Recommended)
Use one of these modes consistently during a session:
1. Immediate mode (default): Save buttons commit directly to GitHub each time.
2. Batch Session Mode: Stage edits while you work, then use **Push All Changes** once.
3. Before publish: ensure staged changes for that page are pushed, then publish.
4. Use **Revision History** in the editor to review commit timeline and rollback safely if needed.
5. If interrupted, restore from local autosave snapshot when prompted.
### Option B: Programmatic (API, Optional for Developers)
Use `POST /api/pages` to create pages programmatically:
```bash
curl -X POST https://your-site.pages.dev/api/pages \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "my-page",
    "title": "My Page Title",
    "template": "blog-post"
  }'
```
### Option C: Manual Setup (Advanced)
For advanced users or Git workflow:
1. **Create the data folder:**
   ```
   data/
   +-- my-page/
       +-- schema.json    # Define the form fields
       +-- content.json   # Initial content
   ```
2. **Commit and push** - the page appears immediately in the admin panel
---
## User Management

Users are managed through the admin panel:

```bash
# First admin: use /admin.html Initial Setup with SETUP_TOKEN
# Then use the web UI to create more users (Users tab)
```

Or manage entirely via web UI: Login as admin -> Users -> Add/Edit/Delete
---
## API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth` | GET | Verify session token |
| `/api/auth` | POST | Login |
| `/api/auth` | PATCH | Change password |
| `/api/auth` | DELETE | Logout |
| `/api/save` | POST | Save content (draft or direct) |
| `/api/publish` | POST | Publish/unpublish content |
| `/api/upload` | POST | Upload images (Cloudflare Images) |
| `/api/pages` | GET | List pages |
| `/api/pages` | POST | Create page (admin/editor) |
| `/api/templates` | GET | List schema templates |
| `/api/users` | GET/POST/PATCH/DELETE | User management (admin) |
| `/api/sessions` | GET/DELETE | Session management (admin) |
| `/api/content` | DELETE | Delete content (admin/editor) |
| `/api/audit` | GET | View audit logs (admin) |
| `/api/setup` | GET/POST | Initial setup status + first admin creation |
| `/api/health` | GET | Health check |
| `/api/history` | GET | Page content commit history (`pageId` query) |
| `/api/rollback` | POST | Rollback page content to a specific commit (admin/editor) |
| `/api/revision-diff` | GET | Compare two page revisions (`from`/`to` refs) |
| `/api/workflow` | POST | Update page workflow status (admin/editor) |
| `/api/scheduled-publish` | POST | Run scheduled publish for due pages (admin/editor) |
| `/api/watch` | GET/POST/DELETE | User watchlist + watched-page activity |
| `/api/blocks` | GET | List reusable content blocks for editor insertion |
See [docs/API.md](docs/API.md) for full API documentation.
---
## Local Development
```bash
# Install Wrangler
npm install -g wrangler
# Copy .env.example to .env.local
# Edit .env.local with your GitHub token and repo
# Optional: auto-create KV namespaces + validate env
npm run setup:local
# Start local server
npm run dev
```
Open http://localhost:8788 to test locally.
---
## Testing
```bash
# Install dev dependencies
npm ci
# Run all tests
npm test
# Run with coverage report
npm run test:coverage
# Validate JSON files
npm run lint:json
# Full validation (lint + test)
npm run validate
# CI-equivalent validation (lint + coverage + env check)
npm run validate:ci
```
---
## Security
| Feature | Implementation |
|---------|----------------|
| Password hashing | PBKDF2 with 100,000 iterations |
| Session tokens | Cryptographically random UUIDs |
| Password comparison | Timing-safe (`crypto.subtle.timingSafeEqual`) |
| Rate limiting | 5 login attempts/minute, 30 saves/minute per IP |
| Content size limit | 1MB maximum |
| Transport | HTTPS enforced by Cloudflare |
| Audit trail | All actions logged to KV + Git commits |
---
## Limits
| Resource | Limit | Notes |
|----------|-------|-------|
| Content size | 1 MB | Per save request |
| Save rate | 30/minute | Per IP address |
| Login rate | 5/minute | Per IP address |
| Users | Unlimited | Stored in Cloudflare KV |
| GitHub API | 5,000/hour | Rarely a concern |
---
## Documentation

| Document | Purpose |
|----------|---------|
| [docs/README.md](docs/README.md) | Documentation index (start here for docs navigation) |
| [README.md](README.md) | Quick start (this file) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design + features |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development + testing |
| [OPERATIONS.md](OPERATIONS.md) | Admin operations + troubleshooting |
| [SECURITY.md](SECURITY.md) | Security policy + best practices |
| [docs/API.md](docs/API.md) | Complete API reference |
| [docs/PASSKEYS_GUIDE.md](docs/PASSKEYS_GUIDE.md) | End-user passkey setup guide |

---

## Troubleshooting

Having issues? See the [comprehensive troubleshooting guide in OPERATIONS.md](OPERATIONS.md#troubleshooting).

Before deploying to production, review the [Pre-Deployment Checklist in CONTRIBUTING.md](CONTRIBUTING.md#pre-deployment-checklist).

**Monitor your deployment** with the health check endpoint:
- Open `https://YOUR_LOON_DOMAIN.pages.dev/api/health` in your browser.
Returns system status, version, and configuration validation. See [health check documentation](docs/API.md#get-apihealth) for troubleshooting failed checks.

**Quick Fixes:**
- **Can't create first admin?** Open `/admin.html`, complete Initial Setup, and verify `SETUP_TOKEN` is configured.
- **Can't complete initial setup?** Verify `SETUP_TOKEN` is set in Cloudflare Pages env vars and redeploy.
- **Need a guided diagnostics view?** Open `/admin/setup-check` and run **Run Full Readiness Check**.
- **Need help creating first content?** Log in as admin and click **Start First Page Wizard**.
- **`KV database not configured` error?** Verify a KV binding exists (`LOON_DB` preferred, `KV` also supported) in Cloudflare Pages project settings. For local CLI flows, check `wrangler.local.toml`/`wrangler.dev.toml`.
- **Bindings UI is grayed out in Cloudflare?** Remove KV blocks from root `wrangler.toml` (or remove that file), redeploy, then add binding `LOON_DB` in dashboard.
- **Passkeys not registering/authenticating?** Check `/api/health` and confirm `passkeys_ready: true` plus correct `RP_ID`/`RP_ORIGIN`.
- **Health check degraded?** Check `/api/health` response to see which required check failed (GitHub token, KV binding, etc.)
- **Login fails?** Wait 10 seconds for KV sync, clear browser cache
- **Content not saving?** Check GitHub token permissions and expiration (see [OPERATIONS.md - GitHub Token Setup](OPERATIONS.md#github-token-setup))

---

## License

MIT License - Use freely, modify freely, no warranty. See [LICENSE](LICENSE).

