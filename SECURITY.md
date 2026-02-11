# Security Policy
## Supported Versions

All current versions are actively supported. For security updates and bug fixes, please keep your LOON installation up to date.

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
| Asset | Protection |
|-------|------------|
| User passwords | PBKDF2 hashed in KV |
| Passkey credentials | ES256 (ECDSA) public keys in KV |
| Recovery codes | PBKDF2 hashed with 100k iterations |
| GitHub token | Encrypted Cloudflare secret |
| Sessions | UUID tokens with 24h TTL |
| Content integrity | Git commit history + user metadata |
| Authentication | Timing-safe comparison + WebAuthn verification |
### What LOON Does NOT Protect
| Risk | Mitigation |
|------|------------|
| Password in transit | HTTPS enforced by Cloudflare |
| Shared device access | Use private/incognito mode; disable "Remember me" |
| Weak passwords | Admin responsibility (min 8 chars enforced) |
| Passkey device theft | Use device PIN/biometric; recovery codes secured offline |
| Content confidentiality | All content in GitHub repo is readable by repo collaborators |
| Session theft | Tokens expire after 24h; use HTTPS only |
---
## Threat Model

### Threats Addressed

1. **Brute force attacks**
   - **Login rate limiting**: 5 authentication attempts per minute per IP address
   - **Save rate limiting**: 30 save requests per minute per IP address
   - Implementation: Cloudflare KV with TTL-based counters
   - Automatic reset after timeout period
   - Returns HTTP 429 (Too Many Requests) when limit exceeded
   
2. **Timing attacks**
   - Passwords compared using `crypto.subtle.timingSafeEqual`
   
3. **Path traversal**
   - Page IDs sanitized to alphanumeric, hyphens, and underscores only
   - No filesystem access; all paths constructed server-side
4. **Cross-site scripting (XSS)**
   - Content escaped when rendered on public pages
   - Admin panel sanitizes user input
5. **Phishing attacks**
   - WebAuthn passkeys are origin-bound (phishing-resistant)
   - Browser enforces domain validation
6. **Cloned device detection**
   - Passkey counter validation tracks usage
   - Detects cloned or synchronized authenticators
7. **Recovery code reuse**
   - One-time use enforcement via KV tracking
   - PBKDF2 hashing with 100,000 iterations
8. **Content injection**
   - Content size limited to 1MB
   - JSON validation before commit
### Threats NOT Addressed (Out of Scope)
1. **WebAuthn attestation trust chain validation**
   - LOON validates clientData/authData and COSE key structure, but does not verify attestation certificates or trust anchors.
2. **Compromised Cloudflare account**
   - If an attacker gains access to your Cloudflare dashboard, they can read secrets
3. **Compromised GitHub token**
   - Use fine-grained tokens with minimal permissions (single repo, contents only)
4. **Social engineering**
   - Admin must securely distribute passwords to users
5. **Denial of service**
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
   - Use the admin UI to reset passwords
   - Regenerate GitHub token annually
4. **Enable passkeys for privileged accounts**
   - Admins should use passkeys for phishing-resistant auth
   - Register multiple passkeys (hardware key + device passkey)
   - Store recovery codes securely offline
5. **Monitor Git history**
   - Review commits for unexpected changes
   - Set up GitHub notifications for the repository
6. **Limit environment variable access**
   - Only grant Cloudflare dashboard access to trusted admins
### For Users
1. **Don't share passwords**
   - Each user should have their own credentials
2. **Consider using passkeys**
   - Passkeys are more secure than passwords (phishing-resistant)
   - Register on multiple devices for redundancy
   - Save recovery codes in a password manager
3. **Use private browsing on shared devices**
   - Prevents "Remember me" from persisting
4. **Log out when finished**
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
## Rate Limiting Configuration

LOON includes built-in rate limiting on authentication and content modification endpoints. These limits are designed to prevent brute force attacks while allowing legitimate users to work normally.

### Current Limits

| Endpoint | Limit | Window | Notes |
|----------|-------|--------|-------|
| `POST /api/auth` (login) | 5 attempts | 1 minute | Blocks after 5 failed attempts per IP |
| `POST /api/save` (save content) | 30 requests | 1 minute | Prevents DoS via rapid saves |

### How Rate Limiting Works

1. IP address tracked via `CF-Connecting-IP` header (set by Cloudflare)
2. Counter stored in KV with TTL (auto-deletes after window expires)
3. Exceeding limit returns HTTP 429 with `Retry-After` header
4. Counter resets after timeout window

### Modifying Rate Limits

**For Login Endpoint** (`functions/api/auth.js`):
```javascript
// Find: const MAX_LOGIN_ATTEMPTS = 5;
const MAX_LOGIN_ATTEMPTS = 10;  // Change 5 to 10 (or your desired limit)

// Find: const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_WINDOW = 300;  // Change 60 to 300 (5-minute window instead)
```

**For Save Endpoint** (`functions/api/save.js`):
```javascript
// Find: const MAX_SAVES_PER_MINUTE = 30;
const MAX_SAVES_PER_MINUTE = 60;  // Change 30 to 60 (allow faster publishing)

// Find: const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_WINDOW = 300;  // Change window size
```

### Why These Values?

- **Login limit (5/min)**: Allows users 5 attempts to enter correct password. At 10 WPM typing speed, 5 attempts ≈ 30 seconds, giving time for mistakes without being punishing. Stops bot attacks that try 1000s of passwords/min.
  
- **Save limit (30/min)**: Allows publishing ~1 article every 2 seconds. Covers normal human workflow (write, save, preview, revise, publish). Prevents accidental rapid-fire save requests and API abuse.

### When to Adjust

| Scenario | Adjustment | Reason |
|----------|-----------|--------|
| Users getting "Too many requests" during normal work | Increase `MAX_SAVES_PER_MINUTE` | Limits are too strict for your workflow |
| Concerned about brute force attacks | Decrease `MAX_LOGIN_ATTEMPTS` and/or `RATE_LIMIT_WINDOW` | Reduce window or attempts allowed |
| High-volume automated publishing | Increase `MAX_SAVES_PER_MINUTE` | Legitimate API usage needs higher limits |
| Bot attack detected in logs | Implement IP blocklist or reduce both limits | Respond to specific threats |

### Monitoring Rate Limiting

Check if users are hitting limits:
```bash
# View audit logs for rate limit events
# Look for login attempts from single IPs
TOKEN="your-admin-token"
curl https://your-domain.com/api/audit \
  -H "Authorization: Bearer $TOKEN" | grep "rate"
```

If you see legitimate users hitting limits, adjust values. Rate limiting should almost never trigger for real users.

---
## Incident Response
If you suspect a security incident:
1. **Rotate the GitHub token** immediately in Cloudflare dashboard
2. **Reset affected user passwords** using the admin UI
3. **Review Git history** for unauthorized commits
4. **Revert unauthorized changes** using `git revert`
5. **Document the incident** and review for lessons learned
---
## Security Audit & Findings

### Input Sanitization
[GOOD]: All user input properly escaped using `escapeHtml()` utility
- HTML entities escaped in correct order (& first)
- All form labels use safe `textContent` (not innerHTML)
- Session usernames and IPs properly escaped

[REVIEW] **Issue Found & Fixed**: Metadata fields (`createdBy`, `modifiedBy`) were not escaped
- **Fix**: Apply `escapeHtml()` to all user-controlled data in metadata
- **Status**: Implemented

### Authentication & Sessions
[GOOD]: Strong security fundamentals
- PBKDF2 password hashing with 100,000 iterations (NIST standard)
- Timing-safe password comparison using `crypto.subtle.timingSafeEqual()`
- WebAuthn passkey support (ES256/ECDSA signatures)
- Recovery codes hashed with PBKDF2 (100,000 iterations)
- Passkey counter validation (cloned device detection)
- Cryptographically random UUID v4 for session tokens
- Automatic session expiration (24 hours via KV TTL)
- Challenge-response with 10-minute TTL (registration/auth)

[REVIEW] **Recommendation**: Consider `sessionStorage` instead of `localStorage`
- `localStorage` vulnerable to same-origin XSS
- `sessionStorage` automatically clears on tab close
- Reduces attack window if XSS found

### RBAC & Authorization
[GOOD]: Proper enforcement on all operations
- Save endpoint checks role before persisting
- User management restricted to admin only
- Contributors cannot edit others' content
- All sensitive operations guarded

### CORS Configuration
[REVIEW] **Default**: CORS allows `*` (any origin)
- **Acceptable for**: Development, public APIs, read-heavy systems
- **For production**: Whitelist specific origins
  - Set `CORS_ORIGIN` environment variable
  - Restrict to your domain only

### Rate Limiting
[GOOD]: KV-backed rate limiting
- Login: 5 attempts per 60 seconds
- Save: 30 requests per 60 seconds
- IP address tracked
- Persists across worker restarts

### Password Requirements
[REVIEW] **Current**: Minimum 8 characters (enforced on password change)
- **Recommendation**: Enforce 12+ characters
- **Recommendation**: Encourage symbols and numbers
- Add client-side validation for new passwords

### API Response Security
[GOOD]: No information leakage
- Generic error messages ("Invalid credentials" instead of username hints)
- No stack traces exposed to clients
- Debug information kept in logs only

### Content Security Policy
[GOOD]: CSP headers configured in _headers file
- Current policy: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self' https://api.github.com; font-src 'self'; frame-ancestors 'none'`
- Allows inline scripts/styles (needed for admin UI and dark mode)
- Restricts external resources to trusted CDNs (Pico CSS, GitHub API)
- Prevents clickjacking with frame-ancestors 'none'

### Security Checklist for Operations

**Initial Deployment**:
- [ ] Set `SETUP_TOKEN` as a secret for first-run setup
- [ ] Remove or rotate `SETUP_TOKEN` after first admin is created
- [ ] Generate strong GitHub token
- [ ] Verify HTTPS enabled (automatic with Cloudflare)
- [ ] Test authentication with strong password
- [ ] Verify rate limiting (test 5 failed logins)
- [ ] Review SECURITY.md with team

**Monthly**:
- [ ] Review audit logs for suspicious activity
- [ ] Check for brute force attempts
- [ ] Verify user roles are appropriate
- [ ] Test password change functionality
- [ ] Run `npm audit` for vulnerabilities

**Quarterly**:
- [ ] Audit all active user sessions
- [ ] Test disaster recovery (GitHub token rotation)
- [ ] Review Cloudflare access logs
- [ ] Verify backups are recoverable

**Annually**:
- [ ] Full security audit (consider external firm)
- [ ] Penetration testing
- [ ] Update cryptographic algorithms
- [ ] Review OWASP Top 10

### Recommended Fixes

**Priority 1 - Critical**:
- Ensure metadata fields use `escapeHtml()` (metadata XSS fix)
- Status: Implemented

**Priority 2 - High**:
- Migrate to `sessionStorage` for tokens
- Status: Recommended for implementation

**Priority 3 - Medium**:
- Add Content Security Policy headers
- Enforce 12+ character passwords
- Status: Recommended

**Priority 4 - Low**:
- Whitelist specific CORS origins
- Consider environment-specific configuration
- Status: Defense-in-depth enhancement

---
