# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab > Report a vulnerability) on the LOON repository, or contact the maintainer directly. Include steps to reproduce and the impact you expect. You will get an acknowledgement within a week.

## Model

LOON separates what is public from what is private:

- **Public:** published pages, their images and site settings, stored in the site's GitHub repository and served as static files.
- **Private:** drafts, history, users, credentials and the audit log, stored in Cloudflare D1 and reachable only through the authenticated API.

Drafts are never written to GitHub, so they cannot leak through the static site or the repository.

## Controls

**Authentication**
- Passwords: PBKDF2-SHA256, random 16-byte salt, 100,000 iterations by default (the Workers maximum). Hashes record their parameters and are upgraded at sign-in.
- Uniform responses and timing for unknown users, wrong passwords and disabled accounts.
- Minimum password length 10. Temporary passwords (new users, resets) must be changed at first sign-in.
- Passkeys (WebAuthn) via SimpleWebAuthn, with single-use, five-minute challenges bound to the site's origin. Recovery codes are random, hashed and single-use, and force a password change.

**Sessions**
- Random 256-bit tokens in `__Host-` prefixed cookies: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- D1 stores only the SHA-256 of each token.
- Changing a password ends other sessions; disabling a user or resetting their password ends all of theirs. Users and admins can revoke sessions.

**Authorization**
- Roles: contributor < editor < admin, checked centrally on every route.
- Contributors see and edit only pages they created; other pages respond as not found.
- Only editors publish; only admins manage users, settings and backups.
- At least one active admin always remains.

**Request hardening**
- State-changing requests must come from the site's own origin (Origin / Fetch Metadata check), on top of SameSite cookies.
- Rate limits on sign-in (per IP and per account), setup, passkeys, writes, publishing, uploads and feedback.
- Body size limits on every endpoint; strict validation of IDs, schemas and content.
- Uploads must be JPEG, PNG, WebP, GIF or AVIF by file signature. SVG is refused.

**Output**
- Markdown is rendered by a built-in renderer that escapes all HTML and allows only `http(s)`, `mailto:`, `tel:`, site-relative and `#` URLs.
- The admin builds its interface with DOM APIs only (a check in CI rejects `innerHTML`).
- Content Security Policy without `unsafe-inline` for the site and the admin, plus `X-Frame-Options: DENY`, `nosniff`, HSTS and a restrictive Permissions-Policy.

**Accountability**
- Audit log of sign-ins, failed sign-ins, user and session changes, page edits, publishing and settings, with IP addresses, kept 90 days by default.
- Every publish is a Git commit naming the person who published.

## Secrets

`GITHUB_TOKEN` should be a fine-grained token limited to the one site repository with only Contents: Read and write. `SETUP_TOKEN` and `CRON_SECRET` should be long random values. Store all three as Secrets in Cloudflare Pages. Backup files contain password hashes and should be kept private.

## Known limits

- PBKDF2 is limited to 100,000 iterations on Workers, below current recommendations for offline cracking resistance. Rate limiting protects against online guessing; keep backups and the D1 database private.
- Passkey attestation is not verified (attestation `none`), which is standard for consumer passkeys.
- Anyone with write access to the GitHub repository or the Cloudflare account can change the site. Protect those accounts with two-factor authentication.
