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

## Next Candidates (Optional)
- No open polish TODOs at this time.
