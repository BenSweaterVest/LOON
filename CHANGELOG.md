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
- Reduced setup-status KV operation cost in `functions/api/setup.js`:
  - Added `meta:setup_complete` marker and `meta:setup_status_cache` key.
  - `GET /api/setup` now uses marker/cache fast paths (`KV.get`) and avoids repeated `KV.list` scans.
  - `POST /api/setup` now persists marker/cache after first admin creation.
- Reduced onboarding setup monitor polling in `admin.html` from every 30 seconds to every 5 minutes to lower baseline API/KV usage during idle admin sessions.
- Added shared KV index utilities in `functions/lib/kv-index.js` and refactored admin/session/watch flows to reduce `KV.list` pressure:
  - `meta:index:users` for `/api/users` listing
  - `meta:index:sessions` and `meta:index:user_sessions:<username>` for `/api/sessions` and user session cleanup paths
  - `meta:index:watch:<username>` for watched-page lookups
  - session metadata shadow keys (`session_meta:<token>`) to avoid broad scans
- Added page-scoped audit feed keys (`audit_feed:page:<pageId>`) in `functions/api/_audit.js` and updated `functions/api/watch.js` to read recent watched-page changes from feed keys before global-audit fallback.
- Reduced GitHub API usage in listing/history paths:
  - Admin page browser now requests `/api/pages?minimal=true&limit=200` to avoid full metadata fan-out.
  - Added short-lived full pages metadata cache in `functions/api/pages.js` for repeated full-mode calls.
  - `functions/api/history.js` now performs owner checks only for contributors, skipping one GitHub read for admin/editor history requests.
- Added scheduled publish index management to reduce GitHub directory scans:
  - New KV key: `meta:index:scheduled_pages`
  - `functions/api/workflow.js` updates the index when status changes to/from `scheduled`
  - `functions/api/publish.js` and `functions/api/rollback.js` prune/update scheduled index state after content status transitions
  - `functions/api/scheduled-publish.js` now prefers index-driven candidate pages and only uses GitHub directory scan as a backfill path
- Added opportunistic stale session index cleanup in `functions/lib/kv-index.js` (`cleanupStaleSessionIndex`) and invoked it from `functions/api/sessions.js`.

