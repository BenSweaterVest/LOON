# Operations

Running a LOON site day to day. Setup is in the [README](README.md).

## Configuration reference

Set these in Cloudflare Pages > your project > Settings > Variables and Secrets. Redeploy after changes.

| Variable | Required | Purpose |
|---|---|---|
| `DB` (D1 binding) | Yes | The database. Settings > Bindings > D1 database, variable name `DB`. |
| `GITHUB_REPO` | Yes | `owner/repo` that LOON publishes to. |
| `GITHUB_TOKEN` | Yes (secret) | Fine-grained token with Contents: Read and write on that repository only. |
| `SETUP_TOKEN` | For setup and restore (secret) | Gates creating the first admin and restoring a backup. Harmless to keep once set up, since both only work on an empty database. |
| `GITHUB_BRANCH` | No | Branch to publish to. Default `main`. Must be your Pages production branch. |
| `CRON_SECRET` | For scheduling (secret) | Authorizes `POST /api/cron`. |
| `SITE_URL` | No | Public address, e.g. `https://example.org`. Enables the sitemap, canonical links and link-preview images. Needed at build time too, so set it for the build environment as well. |
| `SESSION_TTL_HOURS` | No | Sign-in lifetime. Default 24, max 720. |
| `PBKDF2_ITERATIONS` | No | Password hashing cost. Default 100000 (the Workers maximum). Lower it if sign-in fails with error 1102. |
| `AUDIT_RETENTION_DAYS` | No | How long audit entries are kept. Default 90. |
| `RP_ID`, `RP_ORIGIN`, `RP_NAME` | No | Passkey settings. Default to the address the admin is opened on, which is right for `*.pages.dev` and custom domains. Set them only if you serve the admin from several hostnames and want passkeys tied to one. |
| `NODE_VERSION` | Build | `22` |

The **System** page in the admin checks this configuration and can test GitHub write access.

## Scheduled publishing

Editors can schedule a page from the editor. Due pages are published:

- whenever an editor or admin opens the page list, and
- by the optional GitHub Action `.github/workflows/scheduled-publish.yml`, every 15 minutes.

To enable the Action:

1. Set `CRON_SECRET` in Cloudflare Pages and redeploy.
2. In GitHub, repository Settings > Secrets and variables > Actions, add `LOON_URL` (your site address) and `LOON_CRON_SECRET` (the same value).

The Action also clears expired sessions. **Private repositories:** every run bills one minute, so every 15 minutes uses about 2,900 of your 2,000 free minutes. Edit the workflow's cron to `'7 * * * *'` (hourly) to stay free.

If a scheduled page fails validation (for example a required field is empty), the schedule is cleared and the failure appears in the audit log.

## Backups

What lives where:

- **GitHub** (`content/`): every published page, its images and the site settings, with full history.
- **D1**: drafts, page history, users, passkeys, unpublished images, feedback, audit log.

Download a full backup from **System > Download backup**. The file contains password hashes, so store it privately. D1 also keeps its own point-in-time history (Time Travel) for the last 7 days on the free plan, which you can restore from the Cloudflare dashboard or with Wrangler.

**Restoring into a new database** (for example after deleting the database, or moving accounts):

1. Create a new D1 database and bind it as `DB` (see README step 5). Redeploy.
2. Make sure `SETUP_TOKEN` is set.
3. Open `/admin/`. On the setup screen, enter the setup token, open **Restore a backup instead**, and choose the backup file.
4. Sign in with an account from the backup.

**Repository lost or replaced:** point `GITHUB_REPO` at the new repository, then use **System > Republish all content**. Every published page, image and the settings are written back in one commit.

## Custom domain

Cloudflare Pages > your project > Custom domains > Set up a domain. Then update `SITE_URL`. Existing passkeys are tied to the old hostname; users can add a new passkey from My account after signing in with their password.

## Updating LOON

Your site repository started as a copy of LOON. To bring in a newer version:

```bash
git remote add upstream https://github.com/BenSweaterVest/LOON.git
```

```bash
git fetch upstream
```

```bash
git merge upstream/main
```

Keep your `content/` folder when resolving conflicts; it belongs to your site. Run `npm run validate`, push, and Cloudflare deploys the update. Database changes are applied automatically on the first request.

## Routine checks

- **Weekly:** look at Activity > Audit log for failed sign-ins (`auth.login_failed`) and unexpected changes. Clear the Feedback inbox.
- **Monthly:** download a backup. Review users and remove anyone who no longer needs access.
- **Before the token expires:** create a new GitHub token, update `GITHUB_TOKEN`, redeploy, and use System > Test GitHub access.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Admin says "Database not configured" | D1 not bound, or bound after the last deploy | Bind `DB`, then retry the latest deployment |
| Setup says SETUP_TOKEN is not configured | Secret missing or not deployed | Add it, redeploy, reload |
| Publish says "Publishing is not configured" | `GITHUB_REPO` or `GITHUB_TOKEN` missing | Add both, redeploy |
| Publish fails with a GitHub 401/403/404 | Token expired, wrong repository, or missing Contents write permission | System > Test GitHub access shows which; create a new token |
| Published but the site did not change | Pages build failed or is queued | Cloudflare Pages > Deployments; check the build log. Builds are capped at 500 a month |
| Sign-in fails with Cloudflare error 1102 | Password hashing exceeded the CPU limit | Set `PBKDF2_ITERATIONS=50000` and redeploy |
| "Too many requests" | Rate limit (for example 5 sign-in attempts a minute) | Wait a minute |
| Passkey sign-in fails after moving domains | Passkeys are bound to the hostname | Sign in with password, add a new passkey |
| Pages show error 1027 | Daily free Function limit reached (100,000 API requests) | Resets at midnight UTC. Public pages are unaffected |
| Locked out, no admin can sign in | Lost passwords and passkeys | Use a recovery code. As a last resort, run `DELETE FROM users` in the D1 console (Cloudflare dashboard > D1 > your database > Console), then open `/admin/` and run setup again with `SETUP_TOKEN`. Pages and history are kept; other accounts must be recreated |
