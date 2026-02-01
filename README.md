# Project LOON (v2.0.0)

**L**ightweight **O**nline **O**rganizing **N**etwork

A serverless micro-CMS that runs entirely on Cloudflare Pages + GitHub. No database, no servers, $0/month.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](CHANGELOG.md)

---

## Two Operating Modes

| Mode | Use Case | Auth Storage | Users |
|------|----------|--------------|-------|
| **Phase 1: Directory** | Independent users (food trucks, vendors) | Environment Variables | ~95 max |
| **Phase 2: Team** | Hierarchical team (newsroom, company) | Cloudflare KV | Unlimited |

**Phase 1** is simpler to set up. Start here.  
**Phase 2** adds roles (Admin/Editor/Contributor) and scales to more users. See [Phase 2 Setup](docs/PHASE2-SETUP.md).

---

## Features

- **Zero Cost**: Runs entirely on Cloudflare + GitHub free tiers
- **No Database**: Content stored as JSON files in Git
- **WYSIWYG Editor**: Dynamic forms generated from schema
- **Multi-Tenant**: Each user gets their own page with separate password
- **Role-Based Access**: Phase 2 adds Admin, Editor, Contributor roles
- **Mobile-Friendly**: Works on phones and tablets
- **Dark Mode**: Respects system preference automatically
- **Auto-Save**: Drafts saved locally to prevent data loss
- **Remember Me**: Optional persistent login
- **Secure**: Timing-safe auth, rate limiting, encrypted secrets
- **Auditable**: Full Git history of all changes

---

## Quick Start

### 1. Fork/Clone This Repo

```bash
git clone https://github.com/YOUR_USERNAME/loon-skeleton.git
```

### 2. Create Cloudflare Pages Project

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create
2. Connect to Git → Select this repository
3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: *(leave empty)*
4. Deploy

### 3. Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Generate new token:
   - **Name**: `LOON Skeleton`
   - **Repository access**: Only select repositories → select this repo
   - **Permissions**: Contents → Read and write
3. Copy the token (starts with `github_pat_`)

### 4. Add Environment Variables

In Cloudflare Pages → Settings → Environment variables → **Production**:

| Variable | Value |
|----------|-------|
| `GITHUB_REPO` | `your-username/loon-skeleton` |
| `GITHUB_TOKEN` | `github_pat_xxxxx` (mark as Secret) |
| `USER_DEMO_PASSWORD` | `loon123` (mark as Secret) |

### 5. Redeploy

Go to Deployments → Latest → ⋯ → Retry deployment

### 6. Test the Setup

1. Visit `https://your-project.pages.dev/admin.html`
2. Page ID: `demo`
3. Password: `loon123`
4. Edit the form → Save
5. Check GitHub for the commit
6. Visit `https://your-project.pages.dev/` to see public page
7. Verify health: `https://your-project.pages.dev/api/health`

---

## File Structure

```
loon-skeleton/
├── index.html              # Public page (renders JSON content)
├── admin.html              # Phase 1: Editor (password per page)
├── admin-v2.html           # Phase 2: Team editor (sessions + RBAC)
├── 404.html                # Custom error page
├── robots.txt              # Search engine directives
├── _headers                # Cloudflare Pages security headers
├── wrangler.toml           # Local development config
├── package.json            # Node.js config (dev dependencies, scripts)
├── vitest.config.js        # Test configuration
├── .env.example            # Environment variable template
├── .github/
│   ├── workflows/
│   │   ├── ci.yml          # Continuous integration (lint, validate, test)
│   │   ├── release.yml     # Automated release creation
│   │   ├── deploy-check.yml # Deployment readiness verification
│   │   └── security.yml    # Security scanning
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md   # Bug report template
│   │   ├── feature_request.md # Feature request template
│   │   └── config.yml      # Issue template config
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS          # Code review assignments
│   └── FUNDING.yml         # Sponsorship links
├── functions/
│   └── api/
│       ├── _cors.js        # Shared CORS utility (configurable origin)
│       ├── auth.js         # Phase 1: POST /api/auth - password auth
│       ├── auth-v2.js      # Phase 2: /api/auth-v2 - session auth + password change
│       ├── save.js         # Phase 1: POST /api/save - password save
│       ├── save-v2.js      # Phase 2: POST /api/save-v2 - RBAC save
│       ├── users.js        # Phase 2: /api/users - user management (admin)
│       ├── pages.js        # GET /api/pages - list available pages
│       ├── sessions.js     # Phase 2: /api/sessions - session management (admin)
│       ├── content.js      # Phase 2: DELETE /api/content - content deletion
│       └── health.js       # GET /api/health - system status
├── tests/
│   ├── helpers.js          # Test utilities (mock request, env, KV)
│   ├── auth.test.js        # Phase 1 auth tests
│   ├── auth-v2.test.js     # Phase 2 auth tests
│   ├── save.test.js        # Save endpoint tests
│   ├── health.test.js      # Health endpoint tests
│   └── schemas.test.js     # Schema validation tests
├── data/
│   └── demo/
│       ├── schema.json     # Form field definitions
│       └── content.json    # Actual content (edited by users)
├── examples/               # 16 ready-to-use schemas
│   └── ...                 # (see examples/README.md)
├── scripts/
│   ├── manage-users.sh     # Phase 1: CLI for user management
│   ├── bootstrap-admin.sh  # Phase 2: Create first admin user
│   ├── bulk-users.sh       # Phase 2: Bulk user creation from CSV
│   ├── backup-content.sh   # Export content for backup
│   ├── restore-content.sh  # Restore from backup
│   └── validate-json.mjs   # JSON validation script
├── docs/
│   ├── API.md              # Detailed API reference
│   ├── PHASE2-SETUP.md     # Team Mode (KV) setup guide
│   ├── CUSTOMIZATION.md    # Theming and customization
│   ├── OPERATIONS.md       # Day-to-day operations
│   ├── ONBOARDING.md       # User onboarding checklist
│   └── TESTING.md          # Manual testing checklist
├── ARCHITECTURE.md         # Technical deep-dive
├── CHANGELOG.md            # Version history
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
├── README.md               # This file
├── SECURITY.md             # Security policy
├── TROUBLESHOOTING.md      # Common issues
└── USER-GUIDE.md           # Guide for content editors
```

---

## Local Development

Run LOON locally using Wrangler (Cloudflare's CLI):

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

## Testing & CI/CD

### Running Tests

```bash
# Install dev dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage

# Validate JSON files
npm run lint:json

# Full validation (lint + test)
npm run validate
```

### Continuous Integration

GitHub Actions automatically run on every push and pull request:

| Workflow | Purpose |
|----------|---------|
| **CI** | Validates JSON, JavaScript syntax, runs tests |
| **Security** | Scans for hardcoded secrets, vulnerable patterns |
| **Deploy Check** | Verifies all required files exist |
| **Release** | Creates GitHub releases from version tags |

### Creating a Release

```bash
# Tag the release
git tag v2.0.1

# Push the tag (triggers release workflow)
git push origin v2.0.1
```

The release workflow automatically:
1. Extracts changelog for the version
2. Creates a GitHub release
3. Generates release notes

---

## How It Works

```
┌─────────────┐     GET /data/demo/schema.json     ┌─────────────────┐
│   Browser   │◄──────────────────────────────────│ Cloudflare Pages│
│  admin.html │     GET /data/demo/content.json   │  (Static Files) │
└──────┬──────┘◄──────────────────────────────────└─────────────────┘
       │
       │ POST /api/auth { pageId, password }
       │ POST /api/save { pageId, password, content }
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Function                          │
│                                                                 │
│  1. Check password against USER_${PAGEID}_PASSWORD env var     │
│  2. If valid, commit content.json to GitHub via API            │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ PUT /repos/.../contents/data/demo/content.json
                           ▼
                    ┌─────────────┐
                    │   GitHub    │
                    │ Repository  │
                    └──────┬──────┘
                           │
                           │ Webhook → Auto-deploy
                           ▼
                    ┌─────────────────┐
                    │ Cloudflare Pages│
                    │  (Public Site)  │
                    └─────────────────┘
```

---

## Adding More Pages

### Option A: Using the Admin Script (Recommended)

```bash
# Set environment variables
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
export CF_PROJECT_NAME="loon-skeleton"

# Add a new user
./scripts/manage-users.sh add tacos

# Output will include the generated password
```

Then create the data files:
```bash
# Copy from examples
cp -r examples/food-truck data/tacos
# Or create your own schema.json and content.json
```

### Option B: Manual Setup

1. **Create the data folder:**
   ```
   data/
   └── tacos/
       ├── schema.json    # Define the form fields
       └── content.json   # Initial content
   ```

2. **Add the password env var** in Cloudflare:
   ```
   USER_TACOS_PASSWORD = some-secure-password
   ```

3. **Commit and push**, then the page is accessible at `/admin.html` with Page ID: `tacos`

---

## User Management

The `scripts/manage-users.sh` script provides CLI commands for user management:

```bash
# Add a new user (generates secure password)
./scripts/manage-users.sh add <page_id>

# Reset a user's password
./scripts/manage-users.sh reset <page_id>

# Deactivate a user
./scripts/manage-users.sh remove <page_id>

# List all configured users
./scripts/manage-users.sh list
```

**Required environment variables:**
- `CF_ACCOUNT_ID` - Your Cloudflare account ID
- `CF_API_TOKEN` - API token with Pages edit permission
- `CF_PROJECT_NAME` - Your Cloudflare Pages project name

---

## Security

| Feature | Implementation |
|---------|----------------|
| Password storage | Cloudflare encrypted env vars |
| Password comparison | Timing-safe (`crypto.subtle.timingSafeEqual`) |
| Rate limiting | 30 requests/minute per IP |
| Content size limit | 1MB maximum |
| Data isolation | Each page ID maps to its own folder |
| Transport | HTTPS enforced by Cloudflare |
| Audit trail | Every save = Git commit with timestamp |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth` | POST | Validate page ID + password |
| `/api/save` | POST | Save content to GitHub |
| `/api/health` | GET | Health check + version info |

---

## Customization

### Change the form fields

Edit `data/demo/schema.json`:

```json
{
  "title": "My Custom Page",
  "fields": [
    { "key": "name", "label": "Your Name", "type": "text" },
    { "key": "bio", "label": "Biography", "type": "textarea" },
    { "key": "status", "label": "Status", "type": "select", "options": ["Available", "Busy"] }
  ]
}
```

### Supported field types

| Type | Description | Options |
|------|-------------|---------|
| `text` | Single line input | `placeholder`, `maxlength`, `pattern` |
| `textarea` | Multi-line text | `placeholder`, `rows`, `maxlength` |
| `select` | Dropdown menu | `options` (array) |
| `email` | Email input | `placeholder`, `maxlength` |
| `url` | URL input | `placeholder` (shows image preview for image/photo/logo fields) |
| `number` | Numeric input | `placeholder`, `min`, `max` |
| `tel` | Phone number | `placeholder` |
| `date` | Date picker | - |
| `time` | Time picker | - |
| `datetime` | Date and time picker | - |
| `checkbox` | Boolean toggle | `description` |
| `hidden` | Not displayed, for metadata | `default` |

All fields support: `required` (boolean), `description` (help text)

### Example Schemas

See the `examples/` folder for ready-to-use schemas:

| Example | Use Case |
|---------|----------|
| `food-truck/` | Food truck tracker, mobile vendors |
| `blog-post/` | Blog posts, articles, announcements |
| `event/` | Events, meetups, conferences |
| `business-hours/` | Store hours, business status |
| `team-profile/` | Staff directory, team pages |
| `job-posting/` | Careers page, job listings |
| `contact-page/` | Contact info, office locations |
| `menu-pricing/` | Restaurant menus, service pricing |
| `announcement/` | Alerts, notices, news items |
| `faq/` | Frequently asked questions |
| `portfolio/` | Project showcase, work samples |
| `product-service/` | Product or service pages |
| `testimonial/` | Customer reviews and quotes |
| `class-workshop/` | Classes, courses, workshops |
| `service-status/` | System status, uptime pages |
| `property-listing/` | Real estate, rentals |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save changes |
| `Escape` | Sign out (with confirmation) |
| `?` | Show keyboard shortcuts help |

---

## Editor Features

| Feature | Description |
|---------|-------------|
| **Dark Mode** | Automatically follows system preference |
| **Auto-Save** | Drafts saved to browser storage every 30 seconds |
| **Remember Me** | Stay signed in for 7 days |
| **Image Preview** | URL fields with "image/photo/logo" in the name show thumbnails |
| **Character Counter** | Fields with `maxlength` show remaining characters |
| **Last Saved** | Shows relative time since last save |

---

## Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Content size | 1 MB | Per save request |
| Save rate | 30/minute | Per IP address |
| Auth rate | 10/minute | Per IP address |
| Users (env vars) | ~95 | Cloudflare limit |
| GitHub API | 5,000/hour | Rarely a concern |

For >95 users, migrate to Cloudflare KV (Phase 2).

---

## Backup & Restore

```bash
# Backup all content to JSON file
./scripts/backup-content.sh

# List pages in a backup
./scripts/restore-content.sh --list backup.json

# Restore a specific page
./scripts/restore-content.sh backup.json page-id

# Restore all pages
./scripts/restore-content.sh backup.json
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for backup schedules and incident response.

---

## Documentation

### For Administrators

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Quick start guide (this file) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture, data flow |
| [SECURITY.md](SECURITY.md) | Security policy, threat model, best practices |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and solutions |
| [docs/API.md](docs/API.md) | Detailed API reference |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Monitoring, backups, maintenance |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | User onboarding checklist |
| [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | Theming, custom domains, i18n |
| [docs/PHASE2-SETUP.md](docs/PHASE2-SETUP.md) | Team Mode with Cloudflare KV |
| [docs/TESTING.md](docs/TESTING.md) | Manual testing checklist |

### For Content Editors

| Document | Description |
|----------|-------------|
| [USER-GUIDE.md](USER-GUIDE.md) | How to use the editor (non-technical) |

### For Contributors

| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute to the project |
| [CHANGELOG.md](CHANGELOG.md) | Version history and roadmap |
| [examples/README.md](examples/README.md) | How to create schemas |

### Inline Documentation

All code files include comprehensive inline documentation:

- **functions/api/*.js** - JSDoc comments, security explanations, step-by-step flow
- **scripts/manage-users.sh** - Usage examples, prerequisites, detailed comments
- **data/*/schema.json** - Field type documentation, customization notes

---

## License

MIT License - Use freely, modify freely, no warranty. See [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## Phase 2 Status

Phase 2 (Team Mode) is fully implemented and available:

- [x] Cloudflare KV for user database (unlimited users)
- [x] Role-based access control (Admin / Editor / Contributor)
- [x] Session-based authentication with 24-hour tokens
- [x] User management API (`/api/users`)
- [x] Session management API (`/api/sessions`)
- [x] Password change functionality (authenticated users)
- [x] Content deletion API (`/api/content`)
- [x] RBAC-filtered page listing (`/api/pages`)

See [docs/PHASE2-SETUP.md](docs/PHASE2-SETUP.md) for setup instructions.

### Future Enhancements

- [ ] Admin UI for user management (web interface)
- [ ] Self-service password reset
- [ ] Two-factor authentication
- [ ] Audit logging
