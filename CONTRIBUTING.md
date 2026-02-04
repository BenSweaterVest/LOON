# Contributing to Project LOON
This document provides guidelines and instructions for contributing.

## Developer Quick Start (5 Minutes)

New to LOON? Get started quickly:

1. **Fork and clone** this repository
2. **Install dependencies**: `npm install`
3. **Run tests**: `npm test` (verify everything works)
4. **Make your changes** in a feature branch
5. **Test again**: `npm run validate` (runs lint + tests)
6. **Submit a PR** with clear description

For local Cloudflare Pages development:
```bash
npm install -g wrangler
wrangler pages dev .  # Starts local server at http://localhost:8788
```

For KV database testing locally, see the [Local Development with KV](#local-development-with-kv) section below.

## Code of Conduct
Be respectful, inclusive, and constructive. We're building something useful together.
## How to Contribute
### Reporting Bugs
1. Check if the bug has already been reported in Issues
2. If not, create a new issue with:
   - Clear title describing the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/environment details
### Suggesting Features
1. Open an issue with the `enhancement` label
2. Describe the feature and its use case
3. Explain why it fits the LOON philosophy (lightweight, serverless, simple)
### Submitting Code
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test locally (see below)
5. Commit with clear messages: `git commit -m "Add: feature description"`
6. Push to your fork: `git push origin feature/my-feature`
7. Open a Pull Request
## Development Setup
### Prerequisites
- GitHub account
- Cloudflare account (free tier)
- Git installed locally
- Node.js 18+ installed
- A text editor (VS Code recommended)
### Installation
1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/loon.git
   cd loon
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Check environment variables** (optional for local testing):
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values (or skip for test-only work)
   npm run check:env
   ```
4. **Verify the setup**:
   ```bash
   npm run lint        # Check syntax
   npm test            # Run tests
   npm run validate    # Full validation
   ```
### Local Testing
Since LOON uses Cloudflare Functions, full testing requires deployment. However, you can:
1. **Run automated tests**:
   ```bash
   npm install     # Install dev dependencies
   npm test        # Run all tests
   npm run lint    # Validate JS and JSON files
   ```
2. **Test the frontend locally**: Open `admin.html` and `index.html` directly in a browser (API calls will fail, but you can test UI)
3. **Use Wrangler for local development**:
   ```bash
   npm install -g wrangler
   wrangler pages dev .
   ```
4. **Deploy to a test project**: Create a separate Cloudflare Pages project for testing
### CI/CD Pipeline
All pull requests automatically run:
- **JSON validation**: All `.json` files are checked for syntax errors
- **JavaScript validation**: All `.js` files are checked for syntax errors
- **Security scan**: Code is scanned for potential hardcoded secrets
- **Automated tests**: Unit tests via Vitest
See `.github/workflows/ci.yml` for details.

## Testing

### Unit Testing
All code changes must have corresponding unit tests.

```bash
# Run all unit tests
npm test

# Run specific test file
npm test -- auth.test.js

# Run with coverage
npm run test:coverage

# Watch mode (auto-rerun on changes)
npm run test:watch
```

**Expected coverage**: 85%+ for production (current: ~90% across modules)

### Integration Testing

**Authentication Flow**:
```bash
# 1. Health check
curl https://localhost:8788/api/health
# Expected: { "status": "healthy", "kv": "connected" }

# 2. Login
TOKEN=$(curl -s -X POST https://localhost:8788/api/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PASSWORD"}' \
  | jq -r '.token')

# 3. Verify session
curl https://localhost:8788/api/auth \
  -H "Authorization: Bearer $TOKEN"
# Expected: { "valid": true, "username": "admin", "role": "admin" }

# 4. Logout
curl -X DELETE https://localhost:8788/api/auth \
  -H "Authorization: Bearer $TOKEN"
# Expected: { "success": true }
```

**Content Save Flow**:
```bash
# Save content
TOKEN="your-token-here"
curl -X POST https://localhost:8788/api/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "test-page",
    "content": {
      "title": "Test",
      "body": "Content"
    }
  }'
# Expected: { "success": true, "commit": "..." }

# Verify content saved (wait for GitHub sync)
curl https://localhost:8788/data/test-page/content.json
# Expected: Your saved content with _meta fields
```

**RBAC Enforcement**:
```bash
# Login as contributor
CONTRIB_TOKEN=$(curl -s -X POST https://localhost:8788/api/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"contributor","password":"PASSWORD"}' \
  | jq -r '.token')

# Try to edit others' content
curl -X POST https://localhost:8788/api/save \
  -H "Authorization: Bearer $CONTRIB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "admin-page",
    "content": {"title": "Hacked"}
  }'
# Expected: HTTP 403 - "Contributors can only edit content they created"
```

**Rate Limiting**:
```bash
# Attempt 6 failed logins (limit is 5/minute)
for i in {1..6}; do
  echo "Attempt $i..."
  curl -X POST https://localhost:8788/api/auth \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrong"}'
done
# 6th attempt should fail: HTTP 429 - "Too many login attempts"
```

**Content Size Validation**:
```bash
# Try to save content >1MB
TOKEN="your-token-here"
LARGE=$(python3 -c "print('{\"data\":\"' + 'x'*1100000 + '\"}')")
curl -X POST https://localhost:8788/api/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pageId\":\"large\",\"content\":$LARGE}"
# Expected: HTTP 413 - "Content too large"
```

### Security Testing

**XSS Prevention**:
```bash
# Try to inject JavaScript into page title
TOKEN="your-token-here"
curl -X POST https://localhost:8788/api/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "xss-test",
    "content": {
      "title": "<img src=x onerror=alert(1)>",
      "body": "<script>alert(\"xss\")</script>"
    }
  }'
# Verify in admin.html: JavaScript should NOT execute, should be escaped
```

**SQL Injection** (N/A for JSON-based system, but test data integrity):
```bash
# Try to send malicious JSON
curl -X POST https://localhost:8788/api/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "test",
    "content": {
      "title": "{\"nested\":\"injected\"}",
      "_meta": {"createdBy": "<script>alert(1)</script>"}
    }
  }'
# Verify: Metadata fields should be safely escaped when displayed
```

### Load Testing

For deployments expecting >50 concurrent users:

```bash
# Install Apache Bench
# macOS: brew install httpd
# Linux: apt-get install apache2-utils

# Test health endpoint (should complete quickly)
ab -n 1000 -c 50 https://localhost:8788/api/health

# Test save endpoint (will be rate-limited)
# Expected: Most requests succeed, some get 429 (rate limit)
ab -n 100 -c 10 -p save-payload.json \
  https://localhost:8788/api/save
```

### Operational Testing

**Before deploying to production**:

- [ ] Test health check works: `/api/health` returns healthy
- [ ] Test authentication: Login, verify, logout
- [ ] Test content save with draft/publish
- [ ] Test image upload (if Cloudflare Images configured)
- [ ] Test user creation and role assignment
- [ ] Test password reset workflow
- [ ] Test backup and restore
- [ ] Test rate limiting (6th login attempt should fail)
- [ ] Test RBAC (contributor can't edit others' content)
- [ ] Test GitHubtoken rotation
- [ ] Verify audit logs work
- [ ] Verify KV namespace is connected
- [ ] Test dark mode in admin UI
- [ ] Test form auto-save functionality
- [ ] Load test with 10-20 concurrent editors
- [ ] Verify Cloudflare deployment shows green status

---
### Code Style
- **JavaScript**: Use modern ES6+ syntax
- **HTML**: Semantic HTML5, accessible markup
- **CSS**: Keep it minimal, prefer Pico CSS utilities
- **Comments**: Explain *why*, not *what*
### File Structure
```
loon/
├── admin.html          # Admin editor (sessions + RBAC)
├── index.html          # Public page - customize per use case
├── functions/
│   └── api/
│       ├── auth.js     # Session authentication
│       ├── save.js     # Save content (draft/direct)
│       ├── publish.js  # Publish/unpublish content
│       ├── upload.js   # Image uploads (Cloudflare Images)
│       ├── users.js    # User management (admin)
│       ├── pages.js    # List available pages
│       ├── sessions.js # Session management (admin)
│       ├── content.js  # Content deletion (admin/editor)
│       ├── templates.js # Schema templates
│       ├── audit.js    # Audit logs (admin)
│       └── health.js   # Health check
├── data/
│   └── {pageId}/
│       ├── schema.json # Field definitions (JSON Schema)
│       └── content.json # Actual content
├── scripts/            # Admin tooling (bash/PowerShell scripts)
├── docs/               # Detailed documentation
└── examples/           # Example schemas for common use cases
```
## Design Principles
When contributing, keep these principles in mind:
### 1. Radical Simplicity
- No build step required
- No npm dependencies in production
- Plain HTML/CSS/JS that any developer can understand
### 2. Data Sovereignty
- All content in readable JSON files
- Git history = audit trail
- User owns their data
### 3. Free Tier Forever
- Must work within Cloudflare free tier limits
- No paid services required
- Optimize for minimal API calls
### 4. Security by Default
- Timing-safe comparisons
- Input sanitization
- No secrets in client code

## Pre-Deployment Checklist

Before deploying to production, verify these steps:

### Environment Configuration
- [ ] `GITHUB_REPO` set to your repository (`your-username/your-repo`)
- [ ] `GITHUB_TOKEN` created with `repo` scope at https://github.com/settings/tokens
- [ ] GitHub token stored as Cloudflare Pages Secret (not visible in public settings)
- [ ] KV namespace `LOON_DB` created and bound in Cloudflare Pages dashboard
- [ ] KV binding named exactly `LOON_DB` in Functions > KV namespace bindings

### Initial Admin Setup
- [ ] Bootstrap script run to create first admin user
- [ ] Admin credentials tested locally before production deployment
- [ ] Bootstrap credentials deleted/regenerated after first login

### Security Verification
- [ ] `ENVIRONMENT=production` set (enables minimal error logging)
- [ ] No hardcoded secrets in environment variables (use Cloudflare Secrets)
- [ ] CORS origin properly configured for your domain
- [ ] GitHub token scoped to minimum permissions needed
- [ ] No `.env` file committed to repository

### Feature Verification
- [ ] Health check passes: `GET /api/health` returns `{"status":"ok"}`
- [ ] Login works with admin credentials
- [ ] Content save and publish flows tested
- [ ] Image uploads work (if `CF_IMAGES_TOKEN` configured)
- [ ] Passkey registration works (if enabled)

### Testing
- [ ] All unit tests pass: `npm run validate`
- [ ] No console errors in browser developer tools
- [ ] Error messages don't leak internal details (e.g., API names, stack traces)
- [ ] Rate limiting tests performed (5+ login attempts should be blocked)

### Documentation
- [ ] README.md updated with correct deployment steps for your setup
- [ ] SECURITY.md reviewed for your threat model
- [ ] Team notified of admin credentials securely (never via email/chat)

## Adding New Features
### Adding a new field type
1. Update `admin.html` → `buildForm()` function
2. Add handling for the new type
3. Document in README.md
4. Add example in a schema file
### Adding a new API endpoint
1. Create `functions/api/{endpoint}.js`
2. Export `onRequestPost`, `onRequestGet`, `onRequestDelete`, etc. as needed
3. Include CORS headers and `onRequestOptions` handler
4. Add rate limiting if accepting user input
5. Add session validation (all KV-based, no environment variables)
6. Add comprehensive JSDoc documentation at top of file
7. Document in `docs/API.md`
### Adding a new example schema
1. Create `examples/{example}/schema.json`
2. Create `examples/{example}/content.json`
3. Document the use case in `examples/README.md`
4. Include all supported field types where relevant
## Questions?
Open an issue with the `question` label, or start a discussion.
---
## License
By contributing, you agree that your contributions will be licensed under the MIT License.
