# TODO

All current polish TODO items are completed as of February 13, 2026.

## Completed
- Shared GitHub helper adoption for `history`, `workflow`, `rollback`, `revision-diff`, `blocks`, and `scheduled-publish`.
- Added endpoint-level rate-limit tests for `users` and `sessions`.
- Standardized protected-endpoint auth errors to:
  - `No authorization token` (missing/invalid auth header)
  - `Invalid or expired session` (token not found/expired)
- Added optional structured security logging mode (`SECURITY_LOG_MODE=structured`).
- Enforced helper coverage checks in CI (`npm run check:helper-coverage`).
- Expanded `docs/API.md` with explicit rate-limit contracts.
- Added KV rate-limit key operations note to `OPERATIONS.md`.
- Extended structured security event logging into workflow endpoints:
  - `/api/publish`
  - `/api/rollback`
  - `/api/workflow`
  - `/api/scheduled-publish`
- Reworked setup-state checks to reduce KV list usage:
  - Added setup/admin marker key (`meta:setup_complete`) and short-lived cache key (`meta:setup_status_cache`).
  - `GET /api/setup` now uses KV `get` fast paths and only falls back to a user scan when marker/cache is missing or stale.
  - `POST /api/setup` now writes the marker/cache keys at admin creation.
- Reduced onboarding setup status auto-refresh interval in `admin.html` from 30 seconds to 5 minutes to lower steady-state API/KV read volume.
- Added KV index helpers to reduce list-heavy scans in admin endpoints:
  - `meta:index:users`
  - `meta:index:sessions`
  - `meta:index:user_sessions:<username>`
  - `meta:index:watch:<username>`
- Refactored endpoints to use indexes with backward-compatible fallback backfills:
  - `functions/api/users.js`
  - `functions/api/sessions.js`
  - `functions/api/watch.js`
  - session create/delete paths in `functions/api/auth.js` and `functions/api/setup.js`
- Added page-scoped audit feed for watch activity reads (`audit_feed:page:<pageId>`) to avoid global audit list scans in watch paths.
- Reduced GitHub API load in page/history flows:
  - Admin page browser now uses `/api/pages?minimal=true&limit=200` (no full metadata fan-out by default).
  - Added short-lived full-page metadata cache in `functions/api/pages.js` to cut repeated `1 + 2*N` GitHub reads.
  - `functions/api/history.js` now skips content-owner lookup for admin/editor requests.
- Added scheduled publish KV index and lifecycle maintenance:
  - `meta:index:scheduled_pages`
  - Updated `workflow`, `publish`, `rollback`, and `scheduled-publish` endpoints to maintain/prune scheduled-page index entries.
  - `scheduled-publish` now prefers index-driven candidate selection, with one-time GitHub scan backfill when the index is missing.
- Added opportunistic stale-session index cleanup:
  - `cleanupStaleSessionIndex()` in `functions/lib/kv-index.js`
  - Triggered from `/api/sessions` read/revoke flows to prune expired session tokens from index/meta keys.

## Next Candidates (Optional)
- Consider adding a low-frequency Cron endpoint that proactively cleans stale index entries (sessions/scheduled pages) rather than relying only on opportunistic request-time cleanup.
