# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | Yes       |
| 1.x     | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Project LOON, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainer directly (see repository owner's profile)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

You can expect a response within 48 hours. We will work with you to understand and address the issue.

---

## Security Model

### What LOON Protects

| Asset | Phase 1 | Phase 2 |
|-------|---------|---------|
| User passwords | Encrypted env vars | PBKDF2 hashed in KV |
| GitHub token | Encrypted Cloudflare secret | Encrypted Cloudflare secret |
| Sessions | N/A | UUID tokens with 24h TTL |
| Content integrity | Git commit history | Git commit history + user metadata |
| Authentication | Timing-safe comparison | Timing-safe comparison |

### What LOON Does NOT Protect

| Risk | Mitigation |
|------|------------|
| Password in transit | HTTPS enforced by Cloudflare |
| Shared device access | Use private/incognito mode; disable "Remember me" |
| Weak passwords | Admin responsibility (min 8 chars enforced in Phase 2) |
| Content confidentiality | All content in GitHub repo is readable by repo collaborators |
| Session theft | Tokens expire after 24h; use HTTPS only |

---

## Threat Model

### Threats Addressed

1. **Brute force attacks**
   - Rate limiting: 10 auth attempts per minute per IP
   - Rate limiting: 30 save requests per minute per IP

2. **Timing attacks**
   - Passwords compared using `crypto.subtle.timingSafeEqual`

3. **Path traversal**
   - Page IDs sanitized to alphanumeric, hyphens, and underscores only
   - No filesystem access; all paths constructed server-side

4. **Cross-site scripting (XSS)**
   - Content escaped when rendered on public pages
   - Admin panel sanitizes user input

5. **Content injection**
   - Content size limited to 1MB
   - JSON validation before commit

### Threats NOT Addressed (Out of Scope)

1. **Compromised Cloudflare account**
   - If an attacker gains access to your Cloudflare dashboard, they can read secrets

2. **Compromised GitHub token**
   - Use fine-grained tokens with minimal permissions (single repo, contents only)

3. **Social engineering**
   - Admin must securely distribute passwords to users

4. **Denial of service**
   - Cloudflare provides some DDoS protection on free tier
   - GitHub API rate limits provide natural throttling

---

## Security Best Practices

### For Administrators

1. **Use strong passwords**
   - Generate with: `openssl rand -base64 24`
   - Minimum 16 characters recommended

2. **Use fine-grained GitHub tokens**
   - Scope to single repository
   - Grant only "Contents: Read and write" permission
   - Set expiration date

3. **Rotate credentials periodically**
   - Use `manage-users.sh reset <page_id>` for user passwords
   - Regenerate GitHub token annually

4. **Monitor Git history**
   - Review commits for unexpected changes
   - Set up GitHub notifications for the repository

5. **Limit environment variable access**
   - Only grant Cloudflare dashboard access to trusted admins

### For Users

1. **Don't share passwords**
   - Each user should have their own credentials

2. **Use private browsing on shared devices**
   - Prevents "Remember me" from persisting

3. **Log out when finished**
   - Especially on shared or public computers

---

## Security Headers

LOON sets the following security headers via `_headers`:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
```

The Content-Security-Policy (CSP) header restricts resource loading:
- Scripts: Same origin and inline (required for admin UI)
- Styles: Same origin, inline, and cdn.jsdelivr.net (Pico CSS)
- Images: Same origin, data URIs, and any HTTPS source
- Connections: Same origin and api.github.com
- Frames: Blocked entirely (prevents clickjacking)

---

## CORS Configuration

By default, LOON API endpoints allow requests from any origin (`*`). For production deployments, you can restrict this to your specific domain.

### Configuration

Set the `CORS_ORIGIN` environment variable in Cloudflare Pages:

```
CORS_ORIGIN=https://your-domain.com
```

| Value | Behavior |
|-------|----------|
| `*` (default) | Allow requests from any origin |
| `https://example.com` | Only allow requests from example.com |

### Implementation

The CORS configuration is implemented in `functions/api/_cors.js`. All API endpoints use this shared utility, which respects the `CORS_ORIGIN` environment variable.

### When to Restrict CORS

Restrict CORS when:
- Your site is production and has a known domain
- You want to prevent other sites from making API calls on behalf of users
- You need defense-in-depth against CSRF-like attacks

Keep CORS open (`*`) when:
- Developing locally with multiple origins
- Building a public API that others can integrate with
- The API endpoints are read-only or require authentication anyway

---

## Incident Response

If you suspect a security incident:

1. **Rotate the GitHub token** immediately in Cloudflare dashboard
2. **Reset affected user passwords** using `manage-users.sh reset`
3. **Review Git history** for unauthorized commits
4. **Revert unauthorized changes** using `git revert`
5. **Document the incident** and review for lessons learned

---

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities (with their permission).
