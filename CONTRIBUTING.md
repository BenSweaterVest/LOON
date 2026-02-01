# Contributing to Project LOON

This document provides guidelines and instructions for contributing.

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
- A text editor (VS Code recommended)

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

### Code Style

- **JavaScript**: Use modern ES6+ syntax
- **HTML**: Semantic HTML5, accessible markup
- **CSS**: Keep it minimal, prefer Pico CSS utilities
- **Comments**: Explain *why*, not *what*

### File Structure

```
loon-skeleton/
├── admin.html          # Phase 1 Editor (password per page)
├── admin-v2.html       # Phase 2 Editor (sessions + RBAC)
├── index.html          # Public page - customize per use case
├── functions/
│   └── api/
│       ├── auth.js     # Phase 1: Password authentication
│       ├── auth-v2.js  # Phase 2: Session authentication
│       ├── save.js     # Phase 1: Save with password
│       ├── save-v2.js  # Phase 2: Save with RBAC
│       ├── users.js    # Phase 2: User management
│       ├── pages.js    # List available pages
│       ├── sessions.js # Phase 2: Session management
│       ├── content.js  # Phase 2: Content deletion
│       └── health.js   # Health check (both phases)
├── data/
│   └── {pageId}/
│       ├── schema.json # Field definitions
│       └── content.json # Actual content
├── scripts/            # Admin tooling (bash scripts)
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
5. Add session validation if Phase 2 only
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
