# LOON Operations Guide
**Audience**: System administrators managing a LOON deployment
**Last Updated**: February 4, 2026
---
## Table of Contents
1. [Environment Setup](#environment-setup)
2. [Daily Operations](#daily-operations)
3. [User Management](#user-management)
4. [Backup & Recovery](#backup--recovery)
5. [Troubleshooting](#troubleshooting)
6. [Monitoring](#monitoring)
7. [Emergency Procedures](#emergency-procedures)
---
## Environment Setup

### Production Environment Variables

All production environment variables should be configured in **Cloudflare Pages > Your Project > Settings > Environment Variables > Production**.

**Required Variables**:

| Variable | Purpose | Example |
|----------|---------|---------|
| `GITHUB_REPO` | Your repository for content storage | `your-username/loon` |
| `GITHUB_TOKEN` | API token for Git operations | Personal Access Token from GitHub |
| `ENVIRONMENT` | Set to "production" for minimal logging | `production` |

**Optional Variables** (for advanced features):

| Variable | Purpose | Example |
|----------|---------|---------|
| `CF_ACCOUNT_ID` | Cloudflare account ID (for Images API) | `abc123def456` |
| `CF_IMAGES_TOKEN` | Token for image uploads | `v1.abc123...` |

**Important**: Never commit `.env` or `.env.production` files with actual tokens. Use Cloudflare's "Secret" flag when setting `GITHUB_TOKEN` and `CF_IMAGES_TOKEN`.

### GitHub Token Setup

1. Create a personal access token at https://github.com/settings/tokens?type=beta
2. Grant **Contents** permission (read + write) on your LOON repository only
3. Copy the token from GitHub
4. In Cloudflare Pages settings, add as environment variable `GITHUB_TOKEN` with **Secret** flag enabled
5. To rotate: Generate a new token, update in Cloudflare, then delete the old token on GitHub

**Why scoped tokens?** Each token should only have the minimum permissions needed. For LOON, that's just repository content access.

### KV Namespace Setup

1. In Cloudflare Dashboard > Workers & Pages > KV, create a namespace (e.g., `LOON_DB`)
2. In Cloudflare Pages project > Settings > Functions > KV namespace bindings
3. Create binding:
   - **Variable name**: `LOON_DB` (must match code exactly)
   - **KV Namespace**: Select the namespace you created
   - **Environment**: Production
4. Note: You can use the same namespace for staging and production, or separate them

### Cloudflare Images Setup (Optional)

To enable image uploads:

1. In Cloudflare Dashboard > Images > Settings, note your Account ID
2. Create an API token at https://dash.cloudflare.com/profile/api-tokens:
   - Permissions: Account > Cloudflare Images > Edit
   - Scope: Account Resources (all)
3. Add to Cloudflare Pages environment variables:
   - `CF_ACCOUNT_ID` = Your account ID
   - `CF_IMAGES_TOKEN` = The API token (as Secret)

---
## Production Checklist
Before going live, confirm:
- KV binding `LOON_DB` is set in Pages Functions and points to the correct namespace
- `GITHUB_REPO` and `GITHUB_TOKEN` are set in Pages environment variables
- `CORS_ORIGIN` is set to your production domain (if you want to restrict origins)
- `RP_ID` and `RP_ORIGIN` are set to your production domain for passkeys
- `/api/health` returns `kv_database: true`

---
## Daily Operations
### Health Check
Verify system status daily:
```bash
# Check health endpoint
curl https://your-loon-domain.com/api/health
```
**Expected response** (HTTP 200):
```json
{
  "status": "ok",
  "timestamp": "2026-02-03T10:30:45.123Z",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```
**If unhealthy**, check:
- Cloudflare Pages deployment status
- KV namespace connectivity
- Environment variables in Cloudflare dashboard
### Session Monitoring
Monitor active sessions (admin only):
```bash
# Login and get token
TOKEN=$(curl -s -X POST https://your-loon-domain.com/api/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
  | jq -r '.token')
# View active sessions
curl https://your-loon-domain.com/api/sessions \
  -H "Authorization: Bearer $TOKEN"
```
Check for:
- Unexpected sessions
- Sessions from unusual locations
- Old sessions (should auto-expire after 24h)
### Audit Log Review
Review audit logs daily for suspicious activity:
```bash
# View audit logs (admin only)
curl https://your-loon-domain.com/api/audit \
  -H "Authorization: Bearer $TOKEN"
```
Monitor for:
- Multiple failed login attempts
- Unusual content edits
- User permission changes
- Sessions from non-office locations
---
## User Management

### First-Time Admin Setup
When deploying LOON for the first time, use the automated bootstrap script to create your first admin user.

Both scripts (`.js` and `.sh`) use bootstrap mode: they store the password temporarily in plaintext, then auth.js hashes it securely (PBKDF2, 100k iterations) on first login.

**Option 1: Node.js script** (cross-platform, requires Node.js):
```bash
node scripts/bootstrap-admin.js \
  --username admin \
  --password YourSecurePassword123 \
  --namespace-id YOUR_KV_NAMESPACE_ID

# The script outputs a wrangler KV command:
wrangler kv:key put --namespace-id YOUR_KV_NAMESPACE_ID \
  'user:admin' '{"username":"admin","role":"admin","password":"...","bootstrap":true,...}'
```

**Option 2: Bash script** (Linux/Mac, requires curl + CF API token):
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
export KV_NAMESPACE_ID="your-kv-namespace-id"

./scripts/bootstrap-admin.sh admin YourSecurePassword123
# Automatically writes to KV via Cloudflare API
```

**Security Notes**:
- Use a strong password (minimum 8 characters)
- Password is stored in plaintext temporarily (bootstrap mode only)
- On first login, auth.js re-hashes the password securely and removes plaintext
- Never commit passwords to version control
- Clear shell history after running: `history -c`

**Windows Users**: Use Git Bash, WSL, or PowerShell to run the bootstrap script:

```powershell
# PowerShell example
node scripts/bootstrap-admin.js --username admin --password YourSecurePassword123 --namespace-id YOUR_KV_ID
```

Note: There is no web-based setup wizard. You must use the bootstrap script to create the first admin.

### Create a New User
After your first admin is set up:

**Via web UI (easiest)**:
1. Login as admin
2. Go to "Users" tab
3. Click "Add User"
4. Enter username, password, and role
5. Click "Create"

**Via script (after first admin)**:
```bash
node scripts/bootstrap-admin.js --username newuser --password TempPassword123
```

### Reset User Password
When a user forgets their password:
1. **Admin resets via UI**:
   - Go to Users tab
   - Find user, click "Reset Password"
   - Share temporary password securely
   - User logs in and changes password (PATCH /api/auth)
2. **User self-service** (if they remember current password):
   - Click Account → Change Password
   - Enter current and new password
   - Click Update
### Delete a User
Via UI (admin only):
1. Go to Users tab
2. Find user, click "Delete"
3. Confirm deletion
Warning: **Warning**: Deleting a user does NOT delete their content. Content remains in Git with `createdBy` metadata.
### Revoke User Access (Immediate)
If user is compromised:
1. Terminate all their active sessions:
   ```bash
   # Admin terminates user's sessions via UI
   # Or via API: DELETE /api/sessions/{sessionId}
   ```
2. Change the user's password:
   ```bash
   # Admin resets password in Users tab
   ```
3. Review their recent edits:
   ```bash
   # Check git log for commits by that user
   git log --author="username"
   ```
---
## Backup & Recovery

### Automatic GitHub Release Backups

LOON automatically creates daily backups of all content and uploads them to GitHub Releases:

**Features**:
- **Frequency**: Daily at 2 AM UTC (configurable via `.github/workflows/backup.yml`)
- **Format**: tar.gz archive of entire `data/` directory
- **Retention**: Automatic cleanup of backups older than 30 days
- **Manual backups**: Trigger anytime via GitHub Actions > backup workflow > "Run workflow"

**To restore from a backup**:
```bash
# 1. Go to GitHub repository Releases
# 2. Download the backup-{number}.tar.gz file
# 3. Extract locally
tar -xzf backup-*.tar.gz

# 4. Verify the extracted content
ls -la data/

# 5. Copy restored content back to repo (if needed)
cp -r data/* /path/to/loon/data/

# 6. Commit and push if restoring a deleted page
git add data/
git commit -m "Restore content from backup"
git push
```

**Backup verification**:
- Check GitHub Releases tab regularly to confirm backups are being created
- Each backup includes the workflow run number for tracking: `backup-{run_number}.tar.gz`
- Release body includes these restoration instructions

### Manual Content Export

For immediate backup before maintenance:
```bash
tar -czf backup-manual-$(date +%Y%m%d-%H%M%S).tar.gz data/
```

### Point-in-Time Recovery

Since content is stored in GitHub, you can revert to any commit:
```bash
# View recent commits
git log --oneline data/

# Revert to specific commit
git revert <commit-sha>

# Or restore exact version
git checkout <commit-sha> -- data/page-id/content.json
git commit -m "Restore page-id to commit <commit-sha>"
git push
```

### GitHub Token Compromise

**If GitHub token is compromised**:
1. **Revoke the token immediately**:
   - Go to GitHub Settings → Developer settings → Tokens
   - Delete the compromised token
2. **Create new token**:
   - Generate new fine-grained token (see README setup)
   - Same permissions: Contents → Read and write on this repo
3. **Update environment variable**:
   - Cloudflare Pages → Settings → Environment Variables
   - Update `GITHUB_TOKEN` with new token
   - Redeploy: Deployments → Latest → Retry deployment
4. **Review audit log for suspicious commits**:
   ```bash
   git log --since="2 hours ago" --oneline
   ```
5. **If unauthorized changes detected**:
   - Review commits: `git log -p --since="..."`
   - Revert changes: `git revert <commit-sha>`
   - Push: `git push`
---
## Troubleshooting
### Login Issues
**Symptom**: "Invalid credentials" error
**Solutions**:
1. Verify username and password are correct
2. Check that user exists: `curl /api/health`
3. Wait 60 seconds if rate-limited (5 attempts/minute)
4. Admin: Check user record in KV via Cloudflare dashboard
**Symptom**: "Session expired" after login
**Causes**:
- Session tokens expire after 24 hours (hard limit)
- User logged in, then refreshed page after 24h
**Solution**: User must login again
### Save Failures
**Symptom**: "Save failed" error
**Possible causes**:
1. **GitHub API rate limit** (5,000 requests/hour):
   - Wait a few minutes
   - Admin: Check GitHub status page
   - Reduce number of concurrent editors
2. **Content too large** (>1MB):
   - Error message shows actual size
   - Reduce content or split into multiple pages
   - Remove embedded images (use URLs instead)
3. **GitHub token expired**:
   - Admin: See "GitHub Token Compromise" section
   - Wait 5 minutes, then retry
4. **Network timeout**:
   - Automatically retried 3 times with backoff
   - If persistent, check Cloudflare status
### Permission Denied
**Symptom**: "Contributors can only edit content they created"
**Cause**: User is Contributor role trying to edit someone else's content
**Solutions**:
- User should create new content (allowed)
- Admin/Editor can edit any content
- Admin: Promote contributor to editor role
### Missing Pages
**Symptom**: Page doesn't appear in editor
**Causes**:
1. `data/{pageId}/` folder doesn't exist
2. `schema.json` is missing or invalid
3. Cloudflare hasn't redeployed yet (wait 2 minutes)
**Solutions**:
1. Check Git: `git ls data/`
2. Verify schema exists: `git show data/{pageId}/schema.json`
3. Force redeploy: Cloudflare Pages ? Deployments ? Retry latest
4. Check for JSON syntax errors: `node -c functions/api/*.js`
---
## Monitoring
### KV Usage Metrics
Monitor Cloudflare KV usage:
1. Cloudflare Dashboard ? Workers & Pages ? KV
2. Click namespace "LOON_DB"
3. View: Operations, Reads, Writes, Deletes
**Typical usage** for 10 active users:
- ~100 writes/day (users logging in, content saves)
- ~500 reads/day (session validation, auth checks)
- ~10 deletes/day (session cleanup, cleanup tasks)
**Alerts**:
- If writes exceed 10,000/day ? Too many operations, investigate usage
- If reads exceed 100,000/day ? Check for polling loops in frontend
### GitHub API Rate Limit
Monitor GitHub token usage:
```bash
# Check rate limit status
curl -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq .
```
**Expected**:
- 5,000 requests/hour authenticated
- After 10 users saving 100 times/hour: ~500 requests ? OK
**If approaching limit**:
1. Contact GitHub support for higher limits (free for public repos)
2. Reduce polling frequency in frontend
3. Batch operations where possible
### Cloudflare Worker Invocations
View in Cloudflare Dashboard ? Workers & Pages ? LOON ? Analytics
**Typical invocations per day**:
- 50 users - 2-5 requests/user = 100-250 invocations
- All requests to `/api/*` count as function invocations
**Free tier limit**: 100,000 invocations/day (very generous)
---
## Emergency Procedures
### Site Unavailable
**Symptom**: 404 or blank page when visiting domain
**Steps**:
1. Check Cloudflare Pages deployment:
   - Dashboard ? Pages ? Your Project
   - View Deployments tab
   - If "Failed", click "Retry"
2. Check environment variables:
   - Pages ? Settings ? Environment Variables
   - Verify `GITHUB_TOKEN` and `GITHUB_REPO` exist
3. Check KV namespace binding:
   - Pages ? Settings ? Functions
   - Verify "LOON_DB" namespace is bound
4. Wait 1-2 minutes for redeploy to complete
### All Users Locked Out
**Symptom**: Nobody can login, KV appears down
**Steps**:
1. Check Cloudflare KV status:
   - Dashboard ? Workers ? KV
   - Verify namespace exists
   - View Recent Errors tab
2. If KV is down:
   - Wait for Cloudflare to recover (usually 5-10 minutes)
   - No manual recovery needed
3. If KV appears corrupted:
   - Delete namespace
   - Create new KV namespace with same name
   - Update binding in Pages settings
   - Recreate first admin user: `node scripts/bootstrap-admin.js --username admin --password SecurePass123`
   - All previous content is safe (in GitHub)
### GitHub Integration Broken
**Symptom**: Saves fail with "GitHub PUT failed"
**Steps**:
1. Check GitHub token:
   - Visit https://github.com/settings/tokens
   - Confirm token hasn't expired (no expiration is best)
   - Confirm token has "Contents: Read and write" permission
2. Verify token in Cloudflare:
   - Pages ? Settings ? Environment Variables
   - Confirm `GITHUB_TOKEN` is set to your PAT token
3. Test token manually:
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" \
     https://api.github.com/repos/YOUR_REPO/contents/data/demo/content.json
   ```
4. If token needs replacement:
   - See "GitHub Token Compromise" section above
### Disk Space / KV Quota Exceeded
**Symptom**: "KV quota exceeded" error
**Note**: Cloudflare KV has 1GB per namespace (free tier)
**Steps**:
1. Check KV usage:
   - Dashboard ? Workers ? KV ? LOON_DB
   - View storage metrics
2. Reduce usage:
   - Archive old sessions: `DELETE /api/sessions` (admin)
   - Review audit logs: Audit logs expire after 30 days automatically
3. If critical:
   - Contact Cloudflare support for quota increase
   - Or migrate to larger plan
---
## Scheduled Maintenance
### Weekly
- [ ] Review audit logs for suspicious activity
- [ ] Check GitHub API rate limit usage
- [ ] Verify KV namespace health
- [ ] Test backup/restore process
### Monthly
- [ ] Full security audit (user accounts, permissions)
- [ ] Review GitHub commits for unauthorized changes
- [ ] Update LOON version if new release available
- [ ] Test disaster recovery procedures
### Quarterly
- [ ] Review and update access controls
- [ ] Audit all active user sessions
- [ ] Test full backup restoration
- [ ] Performance review (response times, error rates)
---
## Common Issues & Solutions

### Login Problems
**"Invalid credentials"**:
- Verify password is correct (use visibility toggle)
- Check username and page ID (lowercase, alphanumeric)
- Confirm environment variables are set in Cloudflare

**"Page not found"**:
- Create folder: `data/your-page-id/`
- Add `schema.json` and `content.json`
- Wait 1-2 minutes for Cloudflare to redeploy

**Rate limit exceeded (login)**:
- Limit: 5 attempts per 60 seconds
- Wait 60 seconds and retry

### Save Problems
**"Save failed"**:
- Check GitHub token is valid and has "Contents: Read and write" permission
- Verify `GITHUB_REPO` format: `username/repo-name`
- Wait if rate limited (60 seconds)

**"Content too large"**:
- Content exceeds 1MB limit
- Reduce size (typically image URLs, not embedded files)

**Changes not appearing on public site**:
- Wait 60-90 seconds for Cloudflare redeploy
- Hard refresh browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Check GitHub repo for the commit
- Verify `/api/health` shows "healthy"

### Schema Issues
**Form fields not appearing**:
- Validate JSON at jsonlint.com
- Ensure `fields` array exists
- All fields need `key`, `label`, and `type`

**Select dropdown empty**:
- Add `options` array: `["Option1", "Option2"]`

### KV & Authentication
**"KV not configured"**:
- Create namespace "LOON_DB" in Cloudflare
- Bind in Pages ? Settings ? Functions
- Redeploy

**"Invalid or expired session"**:
- Sessions expire after 24 hours
- Clear localStorage and log in again
- Check `/api/auth` returns valid response

**"Admin access required"**:
- Only admins can access `/api/users`
- Contact your administrator

**"Contributors can only edit their own content"**:
- RBAC enforcement prevents cross-user editing
- Ask an editor/admin or request role upgrade

**Bootstrap admin cannot log in**:
- Verify KV entry exists: Cloudflare > KV > LOON_DB
- Key should be `user:yourusername`
- Re-run bootstrap script if needed

### Deployment Issues
**Cloudflare build failing**:
- Check Cloudflare Pages > Deployments > View logs
- Ensure no invalid files in repository
- Confirm build settings are empty (framework: None, build command: empty)

**Environment variables not working**:
- Variables must be set in "Production" environment
- Trigger redeploy after adding: Deployments > Retry
- Clear browser cache after redeploy

**New user can't log in**:
- Wait a few seconds (KV sync)
- Check user exists in Admin Panel ? Manage Users
- Reset password if needed
- Clear browser cache

**Functions returning 404**:
- Files must be at `functions/api/{name}.js`
- Check file names match routes

### Development Issues
**Wrangler not finding environment variables**:
- Create `.env.local` with:
  ```
  GITHUB_REPO=username/repo-name
  GITHUB_TOKEN=your-personal-access-token
  ```

**Port already in use**:
- Use different port: `npx wrangler pages dev . --port 8789`

### Browser Issues
**Auto-save not working**:
- Check localStorage is enabled
- Private/incognito mode may disable it
- Clear site data if full

**"Remember me" not persisting**:
- Private browsing disables persistence
- Sessions expire after 24 hours
- Check browser privacy settings

**Windows script issues**:
- Bootstrap scripts are bash-only (requires Git Bash or WSL)
- Alternative: Use Cloudflare Dashboard to manually add KV entries
- See README.md for manual user creation via Cloudflare API
- Once first admin is created, use admin UI for subsequent users

### API Issues
**Health check shows "degraded"**:
- Check `GITHUB_REPO` and `GITHUB_TOKEN` are set
- Verify KV namespace connectivity

**CORS errors**:
- Usually masks actual error
- Check Network tab for real error
- Verify API endpoint URL
- Check function isn't throwing error

---
## Getting Help
- **API Reference**: See docs/API.md
- **Architecture Questions**: See ARCHITECTURE.md
- **Security Concerns**: See SECURITY.md
- **Community**: GitHub Issues
---
**Last Review Date**: February 2, 2026
**Next Review Date**: May 2, 2026
