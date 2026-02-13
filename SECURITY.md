# Security Policy

This document is intentionally concise and focused on policy + security design.
Operational runbooks and deployment troubleshooting live in `OPERATIONS.md`.
Endpoint-level behavior and request/response details live in `docs/API.md`.

## Supported Versions
Current mainline versions are supported. Keep your deployment updated with the latest fixes.

## Reporting a Vulnerability
1. Do not open a public issue for a suspected vulnerability.
2. Contact the repository maintainer directly.
3. Include:
   - Description of the issue
   - Steps to reproduce
   - Impact assessment
   - Suggested mitigation (optional)

## Security Model (At a Glance)
LOON uses Cloudflare Pages + Cloudflare KV + GitHub API. Sensitive state is split:

- Authentication/session state in KV
- Content state in Git (auditable history)
- Runtime secrets in Cloudflare encrypted environment variables

## Implemented Controls

### Authentication and Session Security
- Password hashing: PBKDF2-SHA256 (100,000 iterations + salt)
- Timing-safe comparison for credential verification
- Session tokens: cryptographically random UUIDs
- Session TTL: 24 hours in KV
- WebAuthn/passkeys supported (ES256 signatures verified)
- Recovery codes: one-time use, PBKDF2-hashed

### Authorization
- Role-based access control:
  - `admin`
  - `editor`
  - `contributor`
- Contributor edit isolation (own content only)
- Admin-only endpoints for user/session/audit operations

### Input and Request Hardening
- Page/user identifiers sanitized server-side
- JSON payload validation and bounded content size
- KV-backed rate limiting on selected sensitive/write-heavy endpoints
- CORS control via `CORS_ORIGIN`

### Data and Transport
- HTTPS enforced by Cloudflare
- Git commit history provides a content audit trail
- Security headers configured via `_headers`

## Threat Coverage
Addressed:
- Brute-force login attempts (rate limiting)
- Timing attacks on secret comparisons
- Path traversal via identifier sanitization
- Basic XSS risk reduction through safe rendering patterns
- Passkey phishing resistance (origin-bound WebAuthn)

Out of scope / residual risk:
- Compromise of Cloudflare or GitHub admin accounts
- Social engineering and endpoint-user device compromise
- Full WebAuthn attestation trust-chain validation

## Required Production Security Configuration
Set in Cloudflare Pages:
- `GITHUB_REPO`
- `GITHUB_TOKEN` (Secret)
- `SETUP_TOKEN` (Secret, one-time setup gate; rotate/remove after first admin)

Configure KV binding:
- `LOON_DB` preferred
- `KV` compatibility fallback supported

Recommended:
- Restrict `CORS_ORIGIN` to your production domain
- Set `RP_ID` and `RP_ORIGIN` for passkeys in production
- Review `/api/health` after each deploy

## Canonical References
- Deployment and operations: `OPERATIONS.md`
- Installation and first-run setup: `README.md`
- API behavior and errors: `docs/API.md`
- Architecture overview: `ARCHITECTURE.md`
