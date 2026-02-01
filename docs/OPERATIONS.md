# Operations Guide

Day-to-day operations and maintenance for LOON.

---

## Monitoring

### Health Check

Monitor the `/api/health` endpoint:

```bash
curl -s https://your-site.pages.dev/api/health | jq
```

Expected response:
```json
{
  "status": "ok",
  "version": "2.0.0",
  "timestamp": "2026-01-30T12:00:00.000Z",
  "checks": {
    "github_repo": true,
    "github_token": true
  }
}
```

### Automated Monitoring

Use a service like:
- **UptimeRobot** (free) - ping every 5 minutes
- **Pingdom** - detailed monitoring
- **Cloudflare Analytics** - built into dashboard

Set up alerts for:
- Health endpoint returning non-200
- Status "degraded"
- Response time > 2 seconds

### Cloudflare Analytics

View in Cloudflare Dashboard → Pages → Your Project → Analytics:
- Request count
- Bandwidth usage
- Error rates
- Geographic distribution

---

## Backups

### Automated Backups

Content is automatically backed up via Git. Every save creates a commit.

### Manual Backup

```bash
# Run the backup script
./scripts/backup-content.sh

# Output: backups/loon_backup_20260130_120000.json
```

### Backup Schedule Recommendation

| Frequency | Method |
|-----------|--------|
| Every save | Automatic (Git) |
| Daily | Scheduled backup script |
| Weekly | Download Git repo clone |

### Off-site Backup

Clone the repository to another location:

```bash
git clone --mirror https://github.com/user/repo.git backup-repo.git
```

---

## Restoring Content

### From Git History

```bash
# View history for a file
git log --oneline data/demo/content.json

# Restore from specific commit
git checkout abc123 -- data/demo/content.json

# Commit the restoration
git add data/demo/content.json
git commit -m "Restore demo content from backup"
git push
```

### From Backup File

```bash
# List pages in backup
./scripts/restore-content.sh --list backup.json

# Restore specific page
./scripts/restore-content.sh backup.json demo

# Restore all pages
./scripts/restore-content.sh backup.json
```

---

## User Management

### Onboarding a New User

1. **Generate credentials:**
   ```bash
   ./scripts/manage-users.sh add new-user
   ```

2. **Create their data folder:**
   ```bash
   cp -r examples/appropriate-schema data/new-user
   ```

3. **Commit and push:**
   ```bash
   git add data/new-user
   git commit -m "Add new-user page"
   git push
   ```

4. **Send credentials:**
   - Page ID: `new-user`
   - Password: (generated)
   - URL: `https://your-site.pages.dev/admin.html`

5. **Share user guide:**
   - Link to USER-GUIDE.md or create PDF

### Password Reset

```bash
./scripts/manage-users.sh reset user-id
```

Send the new password to the user securely.

### Removing a User

```bash
# Deactivate (keeps data)
./scripts/manage-users.sh remove user-id

# Fully remove (delete data too)
./scripts/manage-users.sh remove user-id
rm -rf data/user-id
git add -A
git commit -m "Remove user-id"
git push
```

### Auditing Changes

```bash
# See who changed what, when
git log --pretty=format:"%h %ad %s" --date=short data/

# See specific user's changes
git log --all --grep="user-id" --oneline

# See diff of recent change
git show HEAD --stat
```

---

## Incident Response

### Content Accidentally Deleted

1. **Don't panic** - Git has history
2. **Find the last good version:**
   ```bash
   git log --oneline data/affected-page/content.json
   ```
3. **Restore:**
   ```bash
   git checkout COMMIT_HASH -- data/affected-page/content.json
   git commit -m "Restore accidentally deleted content"
   git push
   ```

### Credentials Compromised

1. **Immediately rotate GitHub token:**
   - GitHub → Settings → Developer settings → Personal access tokens
   - Generate new token
   - Update in Cloudflare

2. **Reset affected user passwords:**
   ```bash
   ./scripts/manage-users.sh reset affected-user
   ```

3. **Review recent commits:**
   ```bash
   git log --since="2 days ago" --oneline
   ```

4. **Revert malicious changes:**
   ```bash
   git revert BAD_COMMIT
   git push
   ```

### Site Down

1. **Check Cloudflare status:** https://www.cloudflarestatus.com/
2. **Check GitHub status:** https://www.githubstatus.com/
3. **Check health endpoint:** `/api/health`
4. **Check deployment logs:** Cloudflare Dashboard → Deployments

### Rate Limited

If you see "Rate limit exceeded":

1. **Wait 60 seconds** (limits reset automatically)
2. **Check for automated scripts** hitting the API
3. **Consider caching** on your end for read operations

---

## Maintenance

### Rotating GitHub Token

1. Generate new token in GitHub
2. Update in Cloudflare:
   - Pages → Settings → Environment Variables
   - Edit `GITHUB_TOKEN`
   - Save and redeploy

### Updating LOON

1. **Backup first:**
   ```bash
   ./scripts/backup-content.sh
   ```

2. **Pull updates:**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

3. **Test locally:**
   ```bash
   npx wrangler pages dev .
   ```

4. **Deploy:**
   ```bash
   git push
   ```

### Cleanup Old Backups

```bash
# Keep last 30 days of backups
find backups/ -name "*.json" -mtime +30 -delete
```

---

## Scaling

### Approaching 95 Users (Phase 1)

When you have ~80 users, plan for Phase 2:

1. **Audit current users** - remove inactive
2. **Plan KV migration** - see [PHASE2-SETUP.md](PHASE2-SETUP.md)
3. **Consider user consolidation** - can multiple pages share credentials?

### High Traffic

If experiencing slow responses:

1. **Enable longer caching** in `_headers`
2. **Use Cloudflare CDN** (automatic on Pages)
3. **Optimize JSON size** - remove unnecessary data
4. **Consider static generation** for high-traffic pages

---

## Phase 2 Operations

### Monitoring Active Sessions

View who is currently logged in:

```bash
curl https://your-site.pages.dev/api/sessions \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Force Logout a User

If an account is compromised, revoke all their sessions:

```bash
curl -X DELETE https://your-site.pages.dev/api/sessions \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"compromised-user","all":true}'
```

### User Management

```bash
# List all users
curl https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Reset a user's password
curl -X PATCH https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"user","resetPassword":true}'

# Delete a user (also revokes their sessions)
curl -X DELETE https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"former-employee"}'
```

### KV Namespace Monitoring

Check KV usage in Cloudflare Dashboard:
- **Workers & Pages** → **KV** → **LOON_DB**
- View keys, values, and usage metrics
- Free tier: 100K reads/day, 1K writes/day

---

## Checklist: Weekly Maintenance

### Phase 1 (Directory Mode)

- [ ] Check `/api/health` status
- [ ] Review Cloudflare analytics for errors
- [ ] Run backup script
- [ ] Review recent Git commits
- [ ] Check for LOON updates
- [ ] Rotate credentials if > 90 days old

### Phase 2 (Team Mode)

- [ ] All Phase 1 items
- [ ] Review active sessions (`/api/sessions`)
- [ ] Audit user list for inactive accounts
- [ ] Check KV usage metrics
- [ ] Review admin activity logs (Git commits)
- [ ] Ensure bootstrap admin password has been changed
