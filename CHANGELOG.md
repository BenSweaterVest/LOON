# Changelog

All notable changes to Project LOON will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public feedback API documentation in `docs/API.md` (`POST /api/feedback`).
- Automated test coverage for feedback endpoint behavior in `tests/feedback.test.js`.
- Shared KV rate-limit utility in `functions/lib/rate-limit.js`.
- Rate-limit helper tests in `tests/rate-limit.test.js`.
- Project TODO tracker in `TODO.md` for remaining polish tasks.
- Shared GitHub Contents API helper in `functions/lib/github.js`.
- Shared GitHub helper test coverage in `tests/github-helper.test.js`.
- Endpoint-level rate-limit tests for admin APIs:
  - `tests/users-rate-limit.test.js`
  - `tests/sessions-rate-limit.test.js`
- Helper coverage CI gate script in `scripts/check-helper-coverage.mjs`.

### Changed
- Hardened `functions/api/feedback.js` input validation:
  - Enforces sanitized `pageId` format.
  - Rejects empty/whitespace-only feedback messages.
  - Normalizes invalid timestamps to server time.
  - Adds per-IP rate limiting (10 submissions per minute when KV is configured).
- Updated package metadata links in `package.json` to the canonical `BenSweaterVest/LOON` repository.
- Consolidated pageId parsing/sanitization logic into shared helper `functions/lib/page-id.js` and refactored API endpoints to use it.
- Added dedicated pageId utility tests in `tests/page-id.test.js`.
- Removed unused `getCorsHeaders` imports across API handlers to reduce endpoint boilerplate.
- Standardized JSDoc style in key API modules and trimmed overlong header commentary (`pages`, `health`, `save`, `publish`, `_response`).
- Added shared bearer/session utilities in `functions/lib/session.js` and refactored endpoint session parsing to reduce duplication.
- Added session utility tests in `tests/session.test.js`.
- Normalized GitHub API auth header usage in `functions/api/publish.js` to `Bearer`.
- Refactored duplicate KV rate-limit logic to the shared helper across `auth`, `save`, `publish`, `feedback`, `setup`, `sessions`, `upload`, and `users` endpoints.
- Further consolidated session validation/parsing in `content`, `upload`, `sessions`, and `users` handlers via shared session utilities.
- Refactored `save`, `publish`, and `content` endpoints to use shared GitHub helper methods for read/write/delete content operations.
- Refactored `pages` and `templates` endpoints to use shared GitHub helper methods for directory listing, existence checks, file reads, and content writes.
- Extended shared GitHub helper adoption to:
  - `functions/api/history.js`
  - `functions/api/workflow.js`
  - `functions/api/rollback.js`
  - `functions/api/revision-diff.js`
  - `functions/api/blocks.js`
  - `functions/api/scheduled-publish.js`
- Standardized protected-endpoint auth responses to:
  - `No authorization token` (missing/invalid auth header)
  - `Invalid or expired session` (missing/expired session token)
- Added optional structured security event logging (`SECURITY_LOG_MODE=structured`) in shared response utilities and wired events for auth/users/sessions flows.
- Extended structured security event logging coverage to workflow endpoints:
  - `functions/api/publish.js`
  - `functions/api/rollback.js`
  - `functions/api/workflow.js`
  - `functions/api/scheduled-publish.js`
- Hardened security event logging to be opt-in only:
  - `SECURITY_LOG_MODE=structured` for JSON output
  - `SECURITY_LOG_MODE=plain` for text output
  - default unset mode produces no security event logs
- Added helper coverage enforcement to CI validation via `package.json` `validate:ci` (`npm run check:helper-coverage`).
- Expanded API rate-limit documentation in `docs/API.md` and added KV rate-limit key operations notes in `OPERATIONS.md`.

