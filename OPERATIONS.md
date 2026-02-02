# LOON Operations Guide

**Audience**: System administrators managing a LOON deployment  
**Last Updated**: February 2, 2026  
**Version**: 3.1.0

---

## Table of Contents

1. [Daily Operations](#daily-operations)
2. [User Management](#user-management)
3. [Backup & Recovery](#backup--recovery)
4. [Troubleshooting](#troubleshooting)
5. [Monitoring](#monitoring)
6. [Emergency Procedures](#emergency-procedures)

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
  "status": "healthy",
  "version": "3.1.0",
  "kv": "connected",
  "timestamp": "2026-02-02T10:30:45.123Z"
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

### Create a New User

Via web UI (easiest):
1. Login as admin
2. Go to "Users" tab
3. Click "Add User"
4. Enter username, password, and role
5. Click "Create"

Via script:
```bash
./scripts/bootstrap-admin.sh username  # Creates admin user
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

⚠️ **Warning**: Deleting a user does NOT delete their content. Content remains in Git with `createdBy` metadata.

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

### Daily Content Backup

Export all content to local backup:

```bash
./scripts/backup-content.sh
```

This creates: `backup-YYYY-MM-DD-HHMMSS.tar.gz`

**Recommended frequency**: Daily at 2 AM UTC  
**Storage location**: 3 secure locations (cloud backup + local)

### Restore from Backup

If content is accidentally deleted:

```bash
# Extract backup
tar -xzf backup-YYYY-MM-DD-HHMMSS.tar.gz

# Review extracted data
ls backup-data/

# Restore specific page
cp -r backup-data/data/page-id/* data/page-id/
git add data/page-id/
git commit -m "Restore page-id from backup"
git push
```

### Point-in-Time Recovery

Since content is in GitHub, you can revert to any commit:

```bash
# View recent commits
git log --oneline data/

# Revert to specific commit
git revert <commit-sha>

# Or reset to exact version
git checkout <commit-sha> -- data/page-id/content.json
git commit -m "Restore page-id to commit <commit-sha>"
git push
```

### GitHub Token Compromise

**If GitHub token is compromised:**

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
3. Force redeploy: Cloudflare Pages → Deployments → Retry latest
4. Check for JSON syntax errors: `node -c functions/api/*.js`

---

## Monitoring

### KV Usage Metrics

Monitor Cloudflare KV usage:

1. Cloudflare Dashboard → Workers & Pages → KV
2. Click namespace "LOON_DB"
3. View: Operations, Reads, Writes, Deletes

**Typical usage** for 10 active users:
- ~100 writes/day (users logging in, content saves)
- ~500 reads/day (session validation, auth checks)
- ~10 deletes/day (session cleanup, cleanup tasks)

**Alerts**:
- If writes exceed 10,000/day → Too many operations, investigate usage
- If reads exceed 100,000/day → Check for polling loops in frontend

### GitHub API Rate Limit

Monitor GitHub token usage:

```bash
# Check rate limit status
curl -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq .
```

**Expected**:
- 5,000 requests/hour authenticated
- After 10 users saving 100 times/hour: ~500 requests → OK

**If approaching limit**:
1. Contact GitHub support for higher limits (free for public repos)
2. Reduce polling frequency in frontend
3. Batch operations where possible

### Cloudflare Worker Invocations

View in Cloudflare Dashboard → Workers & Pages → LOON → Analytics

**Typical invocations per day**:
- 50 users × 2-5 requests/user = 100-250 invocations
- All requests to `/api/*` count as function invocations

**Free tier limit**: 100,000 invocations/day (very generous)

---

## Emergency Procedures

### Site Unavailable

**Symptom**: 404 or blank page when visiting domain

**Steps**:
1. Check Cloudflare Pages deployment:
   - Dashboard → Pages → Your Project
   - View Deployments tab
   - If "Failed", click "Retry"

2. Check environment variables:
   - Pages → Settings → Environment Variables
   - Verify `GITHUB_TOKEN` and `GITHUB_REPO` exist

3. Check KV namespace binding:
   - Pages → Settings → Functions
   - Verify "LOON_DB" namespace is bound

4. Wait 1-2 minutes for redeploy to complete

### All Users Locked Out

**Symptom**: Nobody can login, KV appears down

**Steps**:
1. Check Cloudflare KV status:
   - Dashboard → Workers → KV
   - Verify namespace exists
   - View Recent Errors tab

2. If KV is down:
   - Wait for Cloudflare to recover (usually 5-10 minutes)
   - No manual recovery needed

3. If KV appears corrupted:
   - Delete namespace
   - Create new KV namespace with same name
   - Update binding in Pages settings
   - Recreate first admin user: `./scripts/bootstrap-admin.sh admin`
   - All previous content is safe (in GitHub)

### GitHub Integration Broken

**Symptom**: Saves fail with "GitHub PUT failed"

**Steps**:
1. Check GitHub token:
   - Visit https://github.com/settings/tokens
   - Confirm token hasn't expired (no expiration is best)
   - Confirm token has "Contents: Read and write" permission

2. Verify token in Cloudflare:
   - Pages → Settings → Environment Variables
   - Check `GITHUB_TOKEN` value starts with `github_pat_`

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
   - Dashboard → Workers → KV → LOON_DB
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

## Getting Help

- **Technical Issues**: Check TROUBLESHOOTING.md
- **API Reference**: See docs/API.md
- **Architecture Questions**: See ARCHITECTURE.md
- **Security Concerns**: See SECURITY.md
- **Community**: GitHub Issues

---

**Last Review Date**: February 2, 2026  
**Next Review Date**: May 2, 2026
