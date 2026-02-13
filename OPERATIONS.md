# LOON Operations Guide
Audience: administrators operating an already-deployed LOON instance.

Last updated: February 11, 2026

## Scope
This is a production runbook only:
- runtime verification
- routine checks
- incident response
- recovery procedures

Operational model:
- All required actions in this runbook are browser-based (GitHub, Cloudflare, LOON admin UI).

Installation and first deploy are documented in `README.md`.
API contracts are documented in `docs/API.md`.

## Operating Baseline
Expected production state:
- Cloudflare Pages deployment is healthy.
- KV binding is present (`LOON_DB` preferred, `KV` fallback supported).
- Required env vars are set: `GITHUB_REPO`, `GITHUB_TOKEN`, `SETUP_TOKEN`, `ENVIRONMENT=production`.
- `/api/health` reports all required checks as `true`.

## Post-Change Verification
Run this after any env/binding/token/deployment change.

Browser-first option:
- Open `/admin.html` and use the built-in **Guided Setup Assistant** card to confirm readiness checks.
- Optional diagnostics-only page: `/admin/setup-check`.

1. Health check (browser)
- Open `https://YOUR_DOMAIN/api/health` in a browser.
- Confirm HTTP 200 and:
  - `checks.kv_database: true`
  - `checks.github_repo: true`
  - `checks.github_token: true`

2. Admin auth check
- Login at `/admin.html`.
- Confirm session is valid and admin UI loads.
- In the Guided Setup Assistant, run **Run Full Readiness Check**.

3. Save-path check
- Edit and save one page.
- Confirm a commit appears in the configured GitHub repo.

## Routine Operations
### Daily
- Check `/api/health`.
- Review recent auth failures and sensitive actions in `/api/audit`.
- Confirm at least one successful save/publish event if editors were active.

### Weekly
- Review active sessions and revoke unknown/stale sessions.
- Validate token expiration dates.
- Spot-check restore from Git history for one page.

### Monthly
- Review role assignments (admin/editor/contributor) for least privilege.
- Rotate secrets/tokens based on your policy.
- Validate passkey settings (`RP_ID`, `RP_ORIGIN`) if passkeys are enabled.

## GitHub Token Setup
Operational guidance for rotation/replacement:
1. Create a fine-grained PAT scoped to this repo only.
2. Grant Contents read/write.
3. Update `GITHUB_TOKEN` in Cloudflare Pages as Secret.
4. Redeploy.
5. Run Post-Change Verification.

## Backup and Recovery
Source of truth is Git history for `data/`.

Restore one page from prior history (GitHub web UI only):
1. Open your repository on GitHub.
2. Navigate to `data/<page-id>/content.json`.
3. Click **History** for that file.
4. Open the commit/version you want to restore.
5. Copy that version's contents.
6. Return to the current file, click **Edit**, paste the restored contents, and commit from the web UI.

Restore an entire page directory (GitHub web UI):
1. Open repository history and identify the last good commit for `data/<page-id>/`.
2. For each file in that folder (`schema.json`, `content.json`, assets), open the historical version.
3. Restore each file via web edit and commit.
4. Confirm Cloudflare Pages redeploy completes successfully.

## Incident Playbooks
### `KV database not configured`
Symptoms:
- login/setup/session endpoints fail
- health check reports `checks.kv_database: false`

Actions:
1. Confirm Pages KV binding exists in Production (`LOON_DB` or `KV`).
2. If using browser-only deployment, fix binding directly in Cloudflare Dashboard (recommended source-of-truth for production).
3. If using Wrangler-managed local config, verify `[[kv_namespaces]]` in `wrangler.local.toml` (or `wrangler.toml` when intentionally used) and ensure namespace IDs match this specific Cloudflare account/project.
4. Redeploy.
5. Recheck `/api/health`.
6. Open `/admin/setup-check` and confirm the KV check reports `Ready`.

### First login/setup fails
Actions:
1. Confirm `SETUP_TOKEN` exists as a Production Secret.
2. Confirm whether an admin already exists.
3. If no admin exists, retry Initial Setup at `/admin.html`.
4. If admin exists, setup is intentionally disabled; use normal login/reset flow.

### Saves fail
Actions:
1. Validate `GITHUB_REPO` format is `owner/repo`.
2. Validate `GITHUB_TOKEN` scope and expiry.
3. Check GitHub API status/rate limits.
4. Redeploy after any env var update.
5. Re-run Post-Change Verification.

### Users cannot login
Actions:
1. Check login rate-limit conditions.
2. Confirm account exists and role is valid.
3. Reset password via admin UI.
4. Clear browser storage and retry.

## Troubleshooting
### Matrix
| Symptom | Most likely cause | First fix |
|---|---|---|
| `KV database not configured` | Missing/wrong KV binding | Bind `LOON_DB` (or `KV`) and redeploy |
| Initial setup disabled | Admin already exists | Use normal login path |
| Login invalid credentials | Wrong password or stale account state | Reset password |
| Save GitHub error | Expired or under-scoped token | Replace `GITHUB_TOKEN` |
| Health degraded | Failed env/binding check | Fix failing check and redeploy |

## Documentation Ownership
To keep docs consolidated:
- `README.md`: install and initial onboarding
- `OPERATIONS.md`: runbook, incidents, recovery
- `docs/API.md`: endpoint behavior and response contracts
- `SECURITY.md`: security policy and controls

Avoid creating one-off operations docs when these can be updated directly.
