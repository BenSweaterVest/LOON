# Project LOON (v3.1.0)

**L**ightweight **O**nline **O**rganizing **N**etwork

A serverless micro-CMS that runs entirely on Cloudflare Pages + GitHub. No traditional database, no servers, $0/month.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.1.0-green.svg)](CHANGELOG.md)

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
- **Secure**: PBKDF2 hashing, timing-safe auth, rate limiting
- **Auditable**: Full Git history of all changes

---

## Quick Start

### 1. Fork/Clone This Repo

```bash
git clone https://github.com/YOUR_USERNAME/loon.git
```

### 2. Create Cloudflare Pages Project

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create
2. Connect to Git → Select this repository
3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: *(leave empty)*
4. Deploy

### 3. Create Cloudflare KV Namespace

1. In Cloudflare Dashboard → Workers & Pages → KV
2. Create namespace: `LOON_DB`
3. Go to your Pages project → Settings → Functions → KV namespace bindings
4. Add binding: `LOON_DB` → Select the namespace you created

### 4. Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Generate new token:
   - **Name**: `LOON CMS`
   - **Repository access**: Only select repositories → select this repo
   - **Permissions**: Contents → Read and write
3. Copy the token (starts with `github_pat_`)

### 5. Add Environment Variables

In Cloudflare Pages → Settings → Environment variables → **Production**:

| Variable | Value |
|----------|-------|
| `GITHUB_REPO` | `your-username/loon` |
| `GITHUB_TOKEN` | `github_pat_xxxxx` (mark as Secret) |

### Optional: One-Command Local Prep

Run the helper script to prepare local dependencies and get guided next steps:

```bash
# macOS/Linux
./scripts/first-deploy.sh

# Windows PowerShell
./scripts/first-deploy.ps1
```

### 6. Bootstrap Admin User

```bash
# Set environment variables
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
export KV_NAMESPACE_ID="your-kv-namespace-id"

# Create first admin user
./scripts/bootstrap-admin.sh admin MySecurePassword123
```

### 7. Redeploy

Go to Deployments → Latest → ⋯ → Retry deployment

### 8. Test the Setup

1. Visit `https://your-project.pages.dev/admin.html`
2. Login with the admin credentials from bootstrap
3. Edit content → Save
4. Check GitHub for the commit
5. Visit `https://your-project.pages.dev/` to see public page
6. Verify health: `https://your-project.pages.dev/api/health`

---

## File Structure

```
loon/
├── index.html              # Public page (renders JSON content)
├── admin.html              # Admin panel (login, edit, manage users)
├── 404.html                # Custom error page
├── robots.txt              # Search engine directives
├── _headers                # Cloudflare Pages security headers
├── wrangler.toml           # Local development config
├── package.json            # Node.js config (dev dependencies, scripts)
├── vitest.config.js        # Test configuration
├── .env.example            # Environment variable template
├── functions/
│   └── api/
│       ├── _cors.js        # Shared CORS utility (configurable origin)
│       ├── _audit.js       # Audit logging utility
│       ├── auth.js         # /api/auth - session auth + password change
│       ├── save.js         # /api/save - content save with RBAC + drafts
│       ├── publish.js      # /api/publish - publish/unpublish workflow
│       ├── upload.js       # /api/upload - image upload (Cloudflare Images)
│       ├── users.js        # /api/users - user management (admin)
│       ├── pages.js        # /api/pages - list and create pages
│       ├── templates.js    # /api/templates - list schema templates
│       ├── sessions.js     # /api/sessions - session management (admin)
│       ├── content.js      # /api/content - content deletion
│       ├── audit.js        # /api/audit - view audit logs (admin)
│       └── health.js       # /api/health - system status
│   └── lib/
│       └── schema-validator.js # JSON Schema conversion + validation
├── tests/
│   ├── helpers.js          # Test utilities (mock request, env, KV)
│   ├── auth.test.js        # Auth endpoint tests
│   ├── save.test.js        # Save endpoint tests
│   ├── pages.test.js       # Pages endpoint tests
│   ├── health.test.js      # Health endpoint tests
│   └── schemas.test.js     # Schema validation tests
├── data/
│   └── demo/
│       ├── schema.json     # Form field definitions
│       └── content.json    # Actual content (edited by users)
├── examples/               # 16 ready-to-use schemas
│   └── ...                 # (see examples/README.md)
├── scripts/
│   ├── first-deploy.sh    # Local prep + guided deploy steps
│   ├── first-deploy.ps1   # Local prep + guided deploy steps (Windows)
│   ├── bootstrap-admin.sh  # Create first admin user
│   ├── bulk-users.sh       # Bulk user creation from CSV
│   ├── backup-content.sh   # Export content for backup
│   ├── restore-content.sh  # Restore from backup
│   ├── migrate-phase1-to-phase2.js # Phase 1 → Phase 2 migration
│   └── validate-json.mjs   # JSON validation script
├── docs/
│   ├── API.md              # Detailed API reference
│   ├── CUSTOMIZATION.md    # Theming and customization
│   └── ONBOARDING.md       # User onboarding checklist
├── ARCHITECTURE.md         # Technical deep-dive
├── CHANGELOG.md            # Version history
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
├── README.md               # This file
├── QA_TESTING_GUIDE.md     # Comprehensive testing guide
├── SECURITY.md             # Security policy
├── TROUBLESHOOTING.md      # Common issues
└── USER-GUIDE.md           # Guide for content editors
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

### Option A: API (Recommended)

Use `POST /api/pages` (admin/editor only) to create a page with a template or custom schema.

### Option B: Manual Setup

1. **Create the data folder:**
   ```
   data/
   └── my-page/
       ├── schema.json    # Define the form fields
       └── content.json   # Initial content
   ```

2. **Commit and push** - the page is accessible at `/admin.html` with Page ID: `my-page`

---

## User Management

Users are managed through the admin panel or scripts:

```bash
# Bootstrap first admin user
./scripts/bootstrap-admin.sh admin

# Bulk create users from CSV
./scripts/bulk-users.sh users.csv
```

Or use the web UI: Login as admin → Manage Users → Add New User

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

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Quick start guide (this file) |
| [IMPLEMENTATION_GUIDE_V3.1.md](IMPLEMENTATION_GUIDE_V3.1.md) | v3.1.0 implementation guide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture |
| [USER-GUIDE.md](USER-GUIDE.md) | Guide for content editors |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and fixes |
| [OPERATIONS.md](OPERATIONS.md) | System admin operations |
| [QA_TESTING_GUIDE.md](QA_TESTING_GUIDE.md) | Comprehensive testing guide |
| [SECURITY.md](SECURITY.md) | Security policy |
| [docs/API.md](docs/API.md) | API reference |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | User onboarding checklist |
| [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | Theming and customization |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## License

MIT License - Use freely, modify freely, no warranty. See [LICENSE](LICENSE).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

### v3.1.0 Highlights

- Unified auth (Phase 1 removed, KV-only)
- Draft/publish workflow with publish endpoint
- Media management via Cloudflare Images
- JSON Schema conversion + validation utilities
- Admin UI enhancements for draft/publish + image upload

### Security & Operations Documentation

**New in v3.1.0+**:
- [OPERATIONS.md](OPERATIONS.md) - Daily operations, backup/recovery, monitoring
- [SCALING.md](SCALING.md) - Capacity planning, performance limits, scaling decisions
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) - Detailed security review and recommendations

### Future Enhancements

- [ ] Self-service password reset
- [ ] Two-factor authentication
- [ ] Content versioning UI (show history, diffs)
