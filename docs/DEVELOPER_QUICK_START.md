# Developer Quick Start Guide

Get up and running with LOON development in 5 minutes.

## Prerequisites

```bash
# Check Node.js version (need 18+)
node --version

# Check npm
npm --version
```

## Setup Steps

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/loon.git
cd loon
npm install
```

### 2. Run Tests (No Config Needed)
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode for development
npm run test:coverage # With coverage report
```

### 3. Lint Code
```bash
npm run lint          # Check JS and JSON
npm run lint:js       # Check only JavaScript
npm run lint:json     # Check only JSON
```

### 4. Validate Everything (Pre-commit)
```bash
npm run validate      # Full validation (lint + test + env check)
```

### 5. (Optional) Local Development with Wrangler

If you want to test with live Cloudflare Functions:

```bash
# Create .env.local from example
cp .env.example .env.local
# Edit .env.local with your GitHub credentials

# Run local dev server (requires wrangler)
npm install -g wrangler
npm run dev           # Without KV
npm run dev:kv        # With KV (requires local setup)
```

## Project Structure for Contributors

```
loon/
├── functions/api/         # API endpoints (what you'll modify most)
│   ├── auth.js           # Authentication logic
│   ├── save.js           # Content saving
│   ├── publish.js        # Draft/publish workflow
│   ├── upload.js         # Image uploads
│   ├── users.js          # User management
│   ├── _cors.js          # Shared CORS utility
│   └── _audit.js         # Shared audit logging
├── tests/                # Test files (one per endpoint)
│   ├── helpers.js        # Mock utilities for testing
│   ├── auth.test.js
│   ├── save.test.js
│   ├── publish.test.js
│   ├── upload.test.js
│   └── health.test.js
├── scripts/              # Utility scripts
│   ├── bootstrap-admin.sh  # Create first admin
│   ├── check-env.mjs      # Validate env vars
│   └── validate-json.mjs  # Validate all JSON
├── docs/                 # Documentation
│   ├── API.md           # Full API reference
│   ├── ERROR_CODES.md   # Error code reference
│   └── CUSTOMIZATION.md # Theming guide
├── data/                # Content (created by users)
│   └── demo/           # Demo page
├── examples/            # Schema templates
├── package.json         # Dependencies and scripts
└── vitest.config.js     # Test configuration
```

## Common Development Tasks

### Add a New API Endpoint

1. Create `functions/api/myendpoint.js`
2. Export `onRequestPost`, `onRequestGet`, etc.
3. Use `_cors.js` and `_audit.js` for consistency
4. Create `tests/myendpoint.test.js` with mocks
5. Run `npm test` to verify
6. Update `docs/API.md` with documentation

### Fix a Bug

1. Find the failing test in `tests/`
2. Trace to the function in `functions/api/`
3. Fix the code
4. Run `npm test` to verify
5. Commit with message like "Fix: description of what changed"

### Add a Test

1. Open `tests/ENDPOINT.test.js`
2. Add a new `it('should...', async () => { ... })` block
3. Mock the KV database using `createMockKV()` from helpers.js
4. Mock HTTP responses using Vitest's `vi.fn()`
5. Run `npm test` to verify

### Update Documentation

1. Edit the relevant `.md` file in `docs/` or root
2. Keep formatting consistent with existing docs
3. Update version numbers if mentioning v3.1.0
4. Test that markdown renders properly on GitHub

## Testing Tips

### Run Specific Test
```bash
npm test auth.test.js        # Single file
npm test -- --reporter=verbose  # Verbose output
```

### Test with Coverage
```bash
npm run test:coverage        # See which code needs tests
```

### UI Test Dashboard
```bash
npm run test:ui              # Interactive test UI in browser
```

## Before You Push

**Always run this before submitting a PR:**

```bash
npm run validate   # Runs lint + test + env check
```

This ensures:
- ✓ All JavaScript syntax is valid
- ✓ All JSON files are valid
- ✓ All tests pass
- ✓ No hardcoded secrets in code
- ✓ Environment variables documented

## Getting Help

- **API questions**: See [docs/API.md](../docs/API.md)
- **Error codes**: See [docs/ERROR_CODES.md](../docs/ERROR_CODES.md)
- **Architecture**: See [ARCHITECTURE.md](../ARCHITECTURE.md)
- **Issues**: Open GitHub Issues
- **Discussions**: Use GitHub Discussions

## Common Issues

### Tests failing after cloning
```bash
npm install               # Make sure all deps installed
npm run validate          # Check for real errors
npm test -- --no-coverage # Run without coverage
```

### "LOON_DB not defined" error
- This is expected locally. Tests use `createMockKV()` to mock the database
- Only matters if you're running `npm run dev` (requires real Cloudflare setup)

### Secrets warning in CI
- Don't add real tokens to code
- Use `.env.local` or `.dev.vars` for local testing
- CI will fail if it detects hardcoded tokens

## Code Style Guidelines

- **Naming**: `camelCase` for variables/functions, `CONSTANT_CASE` for constants
- **Comments**: Add JSDoc blocks for exported functions
- **Error handling**: Use appropriate HTTP status codes
- **Logging**: Use `console.error()` for errors, not `console.log()` in production code
- **Testing**: Write tests alongside new code

## Submitting a PR

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run `npm run validate` (must pass)
4. Commit clearly: `git commit -m "Add: my feature"`
5. Push: `git push origin feature/my-feature`
6. Open PR on GitHub with:
   - Clear title
   - Description of changes
   - Link to related issue (if any)
   - `npm test` results

## What Gets Automatically Checked on Push

- ✓ JSON validation
- ✓ JavaScript syntax
- ✓ Security scan for hardcoded secrets
- ✓ All unit tests
- ✓ Deployment readiness

Your PR will only merge if all checks pass! 🚀

