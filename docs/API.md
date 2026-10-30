# API reference

All endpoints live under `/api/` on the site's own origin and exchange JSON. The admin app is the main client; the API is not designed for cross-origin use.

## Conventions

**Authentication.** Sign in with `POST /api/auth/login` (or a passkey). The response sets an HttpOnly session cookie; send it with every request (browsers do this automatically for same-origin `fetch`).

**CSRF.** `POST`, `PUT`, `PATCH` and `DELETE` must carry an `Origin` header matching the site (browsers add it). Only `/api/cron` is exempt; it uses a bearer secret instead.

**Roles.** `contributor` < `editor` < `admin`. Each endpoint below lists the minimum role. "Public" needs no session.

**Errors.** Non-2xx responses look like:

```json
{ "error": "Content is invalid", "details": [{ "path": "items[0].name", "message": "Name is required" }] }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input. `details` lists problems when available |
| 401 | Not signed in, or wrong credentials |
| 403 | Not allowed; also `details.code = "password_change_required"` until a temporary password is changed, and cross-origin writes |
| 404 | Not found (also used for pages a contributor cannot access) |
| 409 | Conflict: `details.code = "version_conflict"` with `currentVersion`, or a duplicate, or a rule such as keeping one admin |
| 413 | Body too large |
| 429 | Rate limited |
| 502 | GitHub rejected a publish (`details.githubStatus`) |
| 503 | Required configuration missing (setup token, GitHub) |

Timestamps are milliseconds since the epoch.

**Rate limits** (per minute): sign-in 5 per IP and 5 per account; setup 5; passkeys 10; writes 60 per user; publishing 20 per user; uploads 20 per user; feedback 5 per IP.

## Health and setup

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | `{ ok, time }`. Fails with 500 if the database is missing |
| GET | `/api/setup` | Public | `{ needsSetup, setupTokenConfigured }` |
| POST | `/api/setup` | Public | `{ setupToken, username, password, displayName? }`. Creates the first admin and signs in. 409 once any user exists |
| POST | `/api/setup/restore` | Public | `{ setupToken, table, rows }`, only while no users exist. Send `users` last, with `passkeys`, `recovery_codes` and `watches` in the same body |

## Authentication

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | Public | `{ username, password }` returns `{ user, session: { expiresAt } }` |
| POST | `/api/auth/logout` | Public | Ends the current session |
| GET | `/api/auth/me` | Public | `{ user: null }` or `{ user, session: { method, expiresAt }, security: { passkeys, recoveryCodesRemaining } }` |
| POST | `/api/auth/password` | Contributor | `{ currentPassword, newPassword }`. `currentPassword` is not needed in a recovery-code session. Ends other sessions |
| POST | `/api/auth/recovery` | Public | `{ username, code }`. Signs in once and requires a password change |

`user` is `{ username, displayName, role, mustChangePassword }`.

## Passkeys

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/passkeys/register/options` | Contributor | `{ challengeId, options }`. Pass `options` to `startRegistration` |
| POST | `/api/passkeys/register/verify` | Contributor | `{ challengeId, response, name? }` returns `{ passkey, recoveryCodes? }` (codes only for a user's first set) |
| POST | `/api/passkeys/login/options` | Public | `{ username? }` returns `{ challengeId, options }` |
| POST | `/api/passkeys/login/verify` | Public | `{ challengeId, response }` returns `{ user }` and signs in |
| GET | `/api/passkeys` | Contributor | Own passkeys |
| PATCH | `/api/passkeys/:id` | Contributor | `{ name }` |
| DELETE | `/api/passkeys/:id` | Contributor | |
| POST | `/api/passkeys/recovery-codes` | Contributor | Replaces recovery codes, returns `{ recoveryCodes }` |

Challenges expire after five minutes and work once.

## Users and sessions

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/users` | Admin | |
| POST | `/api/users` | Admin | `{ username, role, displayName?, password? }`. Without `password`, returns a one-time `temporaryPassword` |
| PATCH | `/api/users/:username` | Admin | `{ role?, displayName?, disabled? }`. Disabling ends sessions |
| POST | `/api/users/:username/reset-password` | Admin | Returns `{ temporaryPassword }`, ends sessions |
| DELETE | `/api/users/:username` | Admin | Cannot delete yourself or the last admin |
| GET | `/api/sessions` | Contributor | Own sessions; admins may add `?all=1` |
| DELETE | `/api/sessions/:id` | Contributor | Own sessions, or any for admins |
| POST | `/api/sessions/revoke-others` | Contributor | |
| GET | `/api/audit` | Admin | `?actor=&action=&target=&before=&limit=` returns `{ entries, nextBefore }` |

## Pages

A page is `{ id, title, template, schema, data, version, status, workflow, scheduledFor, createdBy, createdAt, updatedBy, updatedAt, publishedAt, publishedBy, published }`.

- `status`: `draft` (never published), `published` (live matches draft) or `modified` (draft is newer than live).
- `workflow`: `draft` or `review`.
- `published`: `{ title, template, schema, data, version, commit }` or `null`.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/templates` | Contributor | Bundled templates with schema and sample data |
| GET | `/api/pages` | Contributor | Summaries. Contributors see only their own |
| POST | `/api/pages` | Contributor | `{ id, title, template?, useSample?, schema? }`. Custom `schema` needs editor |
| GET | `/api/pages/:id` | Contributor | Full page |
| PUT | `/api/pages/:id` | Contributor | `{ baseVersion, title?, data?, schema? }`. Saves the draft; `schema` needs editor. 409 if `baseVersion` is stale |
| DELETE | `/api/pages/:id` | Editor | Unpublishes first if live |
| POST | `/api/pages/:id/duplicate` | Contributor | `{ id, title? }` |
| POST | `/api/pages/:id/workflow` | Contributor | `{ action: "submit" \| "withdraw" \| "reject", note? }`. `reject` needs editor |
| GET | `/api/pages/:id/revisions` | Contributor | Newest first: `{ id, version, kind, title, createdBy, createdAt, note }` |
| GET | `/api/pages/:id/revisions/:rev` | Contributor | Includes `schema` and `data` |
| POST | `/api/pages/:id/revisions/:rev/restore` | Contributor | `{ baseVersion }`. Copies the revision into the draft |

Page IDs are 1 to 64 lowercase letters, digits and single hyphens, and cannot be reserved words (`admin`, `api`, `assets`, `media` and others). Drafts are limited to 1 MB. Content is validated against the schema on save; required fields are enforced on publish.

## Publishing

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/publish` | Editor | `{ pages: ["id", { id, version }] }`, up to 25. One commit. Returns `{ commit, pages }` |
| POST | `/api/unpublish` | Editor | `{ pages: ["id"] }` |
| PUT | `/api/pages/:id/schedule` | Editor | `{ at }` within a year. The latest draft is published when due |
| DELETE | `/api/pages/:id/schedule` | Editor | |
| POST | `/api/pages/:id/rollback` | Editor | `{ revisionId, baseVersion }`. Restores a published revision and publishes it |
| GET | `/api/settings` | Contributor | Site settings |
| PUT | `/api/settings` | Admin | Partial settings; saves and publishes `content/site.json` |
| POST | `/api/republish` | Admin | Rewrites all published pages, their images and settings in one commit |
| POST | `/api/cron` | `Authorization: Bearer <CRON_SECRET>` | Publishes due schedules and cleans expired rows. Returns `{ published: [{ id, ok, commit?, error? }] }` |

Validation errors on publish include `pageId` in each `details` entry. In development without GitHub credentials, publishing updates the database only and `commit` is `null`.

Settings: `{ siteName, tagline, homePage, language, navigation: [{ label, href }], footer, accentColor, feedback }`. `href` is a page ID or a safe URL.

## Media

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/media?filename=&alt=&width=&height=` | Contributor | Body: base64 image data as `text/plain`, at most 1.5 MB decoded. JPEG, PNG, WebP, GIF or AVIF. Identical uploads return the existing record with `duplicate: true` |
| GET | `/api/media` | Contributor | Newest 500 |
| GET | `/api/media/:id/data` | Contributor | The base64 text; `X-Media-Type` holds the MIME type |
| PATCH | `/api/media/:id` | Contributor | `{ alt }`. Own uploads, or any for editors |
| DELETE | `/api/media/:id` | Editor | 409 with `details.pages` while any page uses it |

Media records include `url` (`/media/<id>.<ext>`), which is the public address once a page using it is published. Use that URL in image fields and Markdown.

## Collaboration

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/blocks` | Contributor | |
| POST | `/api/blocks` | Editor | `{ name, body, id? }` |
| PUT | `/api/blocks/:id` | Editor | `{ name?, body? }` |
| DELETE | `/api/blocks/:id` | Editor | |
| GET | `/api/watches` | Contributor | `{ pages, activity }`: watched pages and recent changes by others |
| PUT | `/api/watches/:pageId` | Contributor | |
| DELETE | `/api/watches/:pageId` | Contributor | |
| POST | `/api/feedback` | Public | `{ pageId, message, contact? }`. Published pages only. A filled `website` field is silently ignored (spam trap) |
| GET | `/api/feedback?status=open\|resolved\|all` | Editor | |
| PATCH | `/api/feedback/:id` | Editor | `{ resolved }` |
| DELETE | `/api/feedback/:id` | Editor | |

## Administration

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/diagnostics` | Admin | Configuration checks and counts. `?github=1` also tests repository write access |
| GET | `/api/backup` | Admin | `{ schemaVersion, tables: [{ table, rows }] }` |
| GET | `/api/backup/:table?offset=` | Admin | `{ rows, done }` in chunks (200 rows, or 5 for media) |
