# Project LOON
**L**ightweight **O**nline **O**rganizing **N**etwork
A serverless micro-CMS that runs entirely on Cloudflare Pages + GitHub. No traditional database, no servers, $0/month.
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-available-brightgreen.svg)](docs/)
[![Tests](https://img.shields.io/badge/tests-102%20passing-brightgreen.svg)](#testing)

**New to LOON?** Start with [CONTRIBUTING.md](CONTRIBUTING.md) for 5-minute developer setup.

**Core Features**: Password and passkey authentication, Git-based content, schema validation. For a quick overview of recent updates, see [CHANGELOG.md](CHANGELOG.md).

---
## Features
- **Zero Cost**: Runs entirely on Cloudflare + GitHub free tiers
- **No Database Server**: Content stored as JSON files in Git
- **User Management**: Cloudflare KV for unlimited users
- **Role-Based Access**: Admin, Editor, and Contributor roles
- **Draft/Publish Workflow**: Stage content before going live
- **Media Management**: Upload images via Cloudflare Images
- **JSON Schema Support**: Standards-based schema validation
- **WYSIWYG Editor**: Dynamic forms generated from schema
- **Mobile-Friendly**: Works on phones and tablets
- **Dark Mode**: Respects system preference automatically
- **Audit Logging**: Track all actions in the system
- **Secure**: PBKDF2 hashing, timing-safe auth, WebAuthn passkeys, rate limiting
- **Auditable**: Full Git history of all changes
---
## Quick Start
### 1. Fork/Clone This Repo
```bash
git clone https://github.com/YOUR_USERNAME/loon.git
```
### 2. Create Cloudflare Pages Project
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) ? Workers & Pages ? Create
2. Connect to Git ? Select this repository
3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: *(leave empty)*
4. Deploy
### 3. Create Cloudflare KV Namespace
1. In Cloudflare Dashboard ? Workers & Pages ? KV
2. Create namespace: `LOON_DB`
3. Go to your Pages project ? Settings ? Functions ? KV namespace bindings
4. Add binding: `LOON_DB` ? Select the namespace you created
### 4. Create GitHub Personal Access Token
1. Go to GitHub ? Settings ? Developer settings ? Personal access tokens ? **Fine-grained tokens**
2. Generate new token:
   - **Name**: `LOON CMS`
   - **Repository access**: Only select repositories ? select this repo
   - **Permissions**: Contents ? Read and write
3. Copy the token (starts with `github_pat_`)
### 5. Add Environment Variables
In Cloudflare Pages ? Settings ? Environment variables ? **Production**:
| Variable | Value |
|----------|-------|
| `GITHUB_REPO` | `your-username/loon` |
| `GITHUB_TOKEN` | `github_pat_xxxxx` (mark as Secret) |
### 6. Create Your First Admin User
Before you can log in, you need to create an admin account using the bootstrap script. This is a one-time setup step.
**Prerequisites Checklist:**
- KV namespace `LOON_DB` created and bound to your Pages project (Step 3)
- Pages project deployed successfully (Step 2)
- You have access to Cloudflare Dashboard
**Step 1: Get Your Cloudflare Account ID**
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Right sidebar ? Copy your **Account ID** (looks like: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4`)
**Step 2: Get Your KV Namespace ID**
1. Cloudflare Dashboard ? Workers & Pages ? KV
2. Click on the `LOON_DB` namespace you created
3. Copy the **Namespace ID** from the top
**Step 3: Get Your API Token**
1. Cloudflare Dashboard ? My Profile ? API Tokens
2. Click **"Create Token"** ? Select **"Create Custom Token"**
3. Fill in:
   - **Token name**: `LOON Admin Bootstrap`
   - **Permissions**: Select **Account** → **Cloudflare KV** → check **Edit**
   - **Account Resources**: Include → Your account
4. Click **"Continue to summary"** → **"Create Token"**
5. Copy the token (it starts with a long string)

**Step 4: Run the Bootstrap Script**

Open your terminal in the LOON project folder and run:

```bash
# Create first admin user with bootstrap script
node scripts/bootstrap-admin.js \
  --username admin \
  --password YourSecurePassword123 \
  --namespace-id paste-your-namespace-id \
  --account-id paste-your-account-id
```

The script will output a wrangler KV command to execute to create the user in your KV namespace.

**Windows Users**: Use Git Bash, WSL, or PowerShell to run the Node.js script. Alternatively, create your first admin user via Cloudflare Dashboard → Workers & Pages → KV → select your namespace → Add entry manually (see [OPERATIONS.md](OPERATIONS.md) for JSON structure).

Replace the placeholders with your actual values. Your password must be at least 8 characters.

**Security Note**: After running this, clear your terminal history to remove the token:
```bash
history -c  # macOS/Linux/Git Bash
Clear-History  # Windows PowerShell
```
### 7. Redeploy
Go to your Cloudflare Pages dashboard ? Deployments ? Latest ? ? ? Retry deployment
### 8. Test the Setup
1. Visit `https://your-project.pages.dev/admin.html`
2. Login with username `admin` and the password you set in step 6
3. Click **"+ New Page"** to create your first page
4. Add content and click **Save**
5. Check GitHub to verify the commit was created
6. Visit `https://your-project.pages.dev/` to see public page
7. Verify health: `https://your-project.pages.dev/api/health`
---
## File Structure
```
loon/
+-- index.html              # Public page (renders JSON content)
+-- admin.html              # Admin panel (login, edit, manage users)
+-- 404.html                # Custom error page
+-- robots.txt              # Search engine directives
+-- _headers                # Cloudflare Pages security headers
+-- wrangler.toml           # Local development config
+-- package.json            # Node.js config (dev dependencies, scripts)
+-- vitest.config.js        # Test configuration
+-- .env.example            # Environment variable template
+-- functions/
�   +-- api/
�       +-- _cors.js        # Shared CORS utility (configurable origin)
�       +-- _audit.js       # Audit logging utility
�       +-- auth.js         # /api/auth - session auth + password change
�       +-- save.js         # /api/save - content save with RBAC + drafts
�       +-- publish.js      # /api/publish - publish/unpublish workflow
�       +-- upload.js       # /api/upload - image upload (Cloudflare Images)
�       +-- users.js        # /api/users - user management (admin)
�       +-- pages.js        # /api/pages - list and create pages
�       +-- templates.js    # /api/templates - list schema templates
�       +-- sessions.js     # /api/sessions - session management (admin)
�       +-- content.js      # /api/content - content deletion
�       +-- audit.js        # /api/audit - view audit logs (admin)
�       +-- health.js       # /api/health - system status|       +-- _cors.js        # Shared CORS utility
|       +-- _audit.js       # Shared audit logging
|       +-- _response.js    # Shared response formatting + error handling
|       +-- _webauthn.js    # WebAuthn crypto utilities
|       +-- _passkeys-schema.js  # Passkey KV schema helpers�   +-- lib/
�       +-- schema-validator.js # JSON Schema conversion + validation
+-- tests/
�   +-- helpers.js          # Test utilities (mock request, env, KV)
�   +-- auth.test.js        # Auth endpoint tests
�   +-- save.test.js        # Save endpoint tests
�   +-- pages.test.js       # Pages endpoint tests
�   +-- health.test.js      # Health endpoint tests
�   +-- schemas.test.js     # Schema validation tests
+-- data/
�   +-- demo/
�       +-- schema.json     # Form field definitions
�       +-- content.json    # Actual content (edited by users)
+-- examples/               # 16 ready-to-use schemas
�   +-- ...                 # (see examples/README.md)
+-- scripts/
│   +-- bootstrap-admin.js  # Create first admin user (Node.js)
�   +-- validate-json.mjs   # JSON validation script
+-- docs/
�   +-- API.md              # API reference
+-- ARCHITECTURE.md         # Technical design + features
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
2. Click **"+ New Page"** button
3. Enter a **Page ID** (lowercase, alphanumeric + hyphens only)
4. Select a **Template** or start with a blank schema
5. Click **Create Page**
6. The new page appears in your admin panel and is ready to edit
### Option B: Programmatic (API)
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

Users are managed through the admin panel or bootstrap script:

```bash
# Bootstrap first admin user
node scripts/bootstrap-admin.js --username admin --password SecurePass123

# Then use the web UI to create more users
# Login as admin → Users → Add User
```

Or manage entirely via web UI: Login as admin → Users → Add/Edit/Delete
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
| `/api/health` | GET | Health check |
See [docs/API.md](docs/API.md) for full API documentation.
---
## Local Development
```bash
# Install Wrangler
npm install -g wrangler
# Copy environment template
cp .env.example .env.local
# Edit .env.local with your GitHub token and repo
# Start local server
npx wrangler pages dev .
```
Open http://localhost:8788 to test locally.
---
## Testing
```bash
# Install dev dependencies
npm install
# Run all tests
npm test
# Validate JSON files
npm run lint:json
# Full validation (lint + test)
npm run validate
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
```bash
curl https://your-loon-domain.pages.dev/api/health
```
Returns system status, version, and configuration validation. See [health check documentation](docs/API.md#get-apihealth) for troubleshooting failed checks.

**Quick Fixes:**
- **Can't create first admin?** Use Git Bash on Windows, or manually add KV entry
- **Health check degraded?** Check `/api/health` response to see which check failed (GitHub token, KV binding, etc.)
- **Login fails?** Wait 10 seconds for KV sync, clear browser cache
- **Content not saving?** Check GitHub token permissions and expiration (see [OPERATIONS.md - Environment Setup](OPERATIONS.md#github-token-setup))

---

## License

MIT License - Use freely, modify freely, no warranty. See [LICENSE](LICENSE).
