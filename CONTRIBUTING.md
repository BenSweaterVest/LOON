# Contributing to LOON
This file defines the contributor workflow for code, tests, and docs.

## Fast Start
1. Fork and clone.
2. Install dependencies:
```bash
npm install
```
3. Run checks:
```bash
npm run validate
```
4. Make changes in a feature branch.
5. Re-run `npm run validate`.
6. Open a PR with a clear summary and test evidence.

## Local Development
Prerequisites:
- Node.js 18+
- Git
- (Optional) Wrangler for local Pages simulation

Run local Pages dev server:
```bash
npm run dev
```

KV-enabled local setup (optional):
```bash
npm run setup:local
npm run dev:kv
```

## Testing Requirements
Required before opening a PR:
```bash
npm run lint
npm test
```

Useful extras:
```bash
npm run test:watch
npm run test:coverage
npm run check:env
```

Testing expectations:
- add or update tests for behavior changes
- keep endpoint status/error behavior consistent with `docs/API.md`
- avoid regressing auth, RBAC, and save/publish flows

## Code Standards
- Use modern ES module JavaScript.
- Keep functions small and explicit.
- Reuse shared helpers (`_response.js`, `_cors.js`, `_kv.js`) instead of duplicating logic.
- Prefer clear names over comments; add short comments only when logic is non-obvious.
- Preserve backward compatibility for runtime bindings (`LOON_DB` preferred, `KV` fallback).

## Pull Request Checklist
- [ ] Change is scoped and does not include unrelated refactors.
- [ ] `npm run validate` passes locally.
- [ ] Any new behavior is covered by tests.
- [ ] README/OPERATIONS/API docs updated if behavior or setup changed.
- [ ] Security-impacting changes reviewed (auth, session, passkeys, permissions).

## Pre-Deployment Checklist
- [ ] KV binding configured (`LOON_DB` preferred, `KV` fallback supported).
- [ ] `GITHUB_REPO` set explicitly to `owner/repo`.
- [ ] `GITHUB_TOKEN` set as Secret with Contents read/write.
- [ ] `SETUP_TOKEN` set for initial admin flow, then rotated/removed after setup.
- [ ] `/api/health` returns all checks as `true`.
- [ ] Admin login works at `/admin.html`.
- [ ] One save operation confirms GitHub write path.

## Documentation Consolidation Rules
To avoid fragmented docs:
- `README.md`: install path and first-run setup
- `OPERATIONS.md`: production runbook and troubleshooting
- `docs/API.md`: endpoint contracts
- `SECURITY.md`: security policy and controls
- `docs/README.md`: documentation index

If your change fits one of the files above, update that file instead of creating a one-off document.

## Reporting Bugs and Features
Open a GitHub issue with:
- clear repro steps
- expected vs actual behavior
- environment details (local/Cloudflare, browser, commit SHA if known)

Use the `enhancement` label for feature requests.

## License
By contributing, you agree your contributions are licensed under MIT.
