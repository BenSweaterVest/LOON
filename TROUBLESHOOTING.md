# Troubleshooting Guide

Common issues and their solutions.

---

## Login Issues

### "Invalid credentials" error

**Causes:**
1. Wrong password
2. Wrong page ID
3. Environment variable not set
4. Environment variable named incorrectly

**Solutions:**
1. Verify the password is correct (use password visibility toggle)
2. Page IDs are lowercase and alphanumeric (e.g., `demo`, `food-truck-1`)
3. Check Cloudflare Pages > Settings > Environment Variables
4. Variable must be named `USER_DEMO_PASSWORD` (uppercase page ID)

### "Page not found" error

**Causes:**
1. The `data/{pageId}/` folder doesn't exist
2. Missing `schema.json` file

**Solutions:**
1. Create the folder: `data/your-page-id/`
2. Add both `schema.json` and `content.json` files
3. Commit and push to GitHub
4. Wait for Cloudflare to redeploy (1-2 minutes)

### Rate limit exceeded

**Cause:** Too many login attempts in 60 seconds (limit: 10)

**Solution:** Wait 60 seconds and try again

---

## Save Issues

### "Save failed" error

**Causes:**
1. GitHub token expired or invalid
2. GitHub token lacks permissions
3. Repository name incorrect
4. Rate limit exceeded

**Solutions:**
1. Generate a new GitHub Personal Access Token
2. Ensure token has "Contents: Read and write" permission
3. Check `GITHUB_REPO` format: `username/repo-name`
4. Wait 60 seconds if rate limited

### "Content too large" error

**Cause:** Content exceeds 1MB limit

**Solution:** Reduce content size (typically means image URLs, not embedded images)

### Changes not appearing on public site

**Causes:**
1. Cloudflare hasn't rebuilt yet
2. Browser cache
3. Save actually failed

**Solutions:**
1. Wait 60-90 seconds for Cloudflare to redeploy
2. Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
3. Check GitHub repo for the commit
4. Check `/api/health` to verify system status

---

## Schema Issues

### Form fields not appearing

**Causes:**
1. Invalid JSON in `schema.json`
2. Missing `fields` array
3. Field missing `key` or `type`

**Solutions:**
1. Validate JSON at jsonlint.com
2. Ensure structure matches:
   ```json
   {
     "title": "Page Title",
     "fields": [
       { "key": "fieldName", "label": "Label", "type": "text" }
     ]
   }
   ```

### Select dropdown empty

**Cause:** Missing `options` array

**Solution:** Add options:
```json
{
  "key": "status",
  "type": "select",
  "options": ["Active", "Inactive"]
}
```

---

## Deployment Issues

### Cloudflare build failing

**Causes:**
1. Invalid file in repository
2. Build settings incorrect

**Solutions:**
1. Check Cloudflare Pages > Deployments > View logs
2. Ensure build settings:
   - Framework preset: None
   - Build command: (empty)
   - Build output directory: (empty)

### Environment variables not working

**Causes:**
1. Variables set in wrong environment (Preview vs Production)
2. Need to redeploy after adding variables

**Solutions:**
1. Set variables in "Production" environment
2. Trigger redeploy: Deployments > ... > Retry deployment

### New user can't log in after running manage-users.sh

**Cause:** Cloudflare requires a new deployment for environment variable changes to take effect in Functions.

**Solutions:**
1. Wait 1-2 minutes for automatic propagation
2. If still not working, trigger a redeploy:
   - Cloudflare Dashboard > Pages > Your Project
   - Deployments > Latest > ... > Retry deployment
3. Or push an empty commit:
   ```bash
   git commit --allow-empty -m "Trigger redeploy for new user"
   git push
   ```

**Prevention:** After adding a user with `manage-users.sh`:
1. Create the required data files first
2. Commit and push (this triggers a redeploy)
3. Then give credentials to the user

### Functions returning 404

**Cause:** Functions not in correct location

**Solution:** Files must be at `functions/api/{name}.js`

---

## Local Development Issues

### Wrangler not finding environment variables

**Cause:** Variables not in `.env.local` or `.dev.vars`

**Solution:** Create `.env.local` with:
```
GITHUB_REPO=your-username/repo-name
GITHUB_TOKEN=github_pat_xxxxx
USER_DEMO_PASSWORD=loon123
```

### Port already in use

**Cause:** Another process using port 8788

**Solution:** 
```bash
# Find process
lsof -i :8788

# Or use different port
npx wrangler pages dev . --port 8789
```

---

## Browser Issues

### Dark mode not working

**Cause:** System preference not detected

**Solutions:**
1. Check system dark mode is enabled
2. Browser may override system preference
3. Some browsers require restart

### Auto-save not working

**Cause:** localStorage disabled or full

**Solutions:**
1. Check browser allows localStorage
2. Clear site data if storage is full
3. Private/incognito mode may disable localStorage

### "Remember me" not persisting

**Causes:**
1. Private/incognito browsing
2. Browser clears data on close
3. Session expired (7 days)

**Solution:** Check browser privacy settings

---

## API Issues

### Health check shows "degraded"

**Cause:** Missing environment variables

**Solution:** Check both `GITHUB_REPO` and `GITHUB_TOKEN` are set in Cloudflare

### CORS errors in browser console

**Cause:** Usually a different issue masquerading as CORS

**Solutions:**
1. Check actual error in Network tab
2. Verify API endpoint URL is correct
3. Check function isn't throwing an error

---

## Phase 2 (Team Mode) Issues

### "KV not configured" error

**Cause:** Cloudflare KV namespace not bound

**Solutions:**
1. Create KV namespace "LOON_DB" in Cloudflare Dashboard
2. Go to Pages > Your Project > Settings > Functions
3. Add KV namespace binding:
   - Variable name: `LOON_DB`
   - KV namespace: Select LOON_DB
4. Redeploy

### "Invalid or expired session" error

**Causes:**
1. Session expired (24-hour limit)
2. Session was invalidated (logout)
3. Session token corrupted

**Solutions:**
1. Log in again
2. Clear localStorage and try again
3. Check that /api/auth-v2 returns valid response

### "Admin access required" error

**Cause:** Trying to access user management without admin role

**Solution:** Only admin users can access /api/users. Contact your admin.

### "Contributors can only edit content they created" error

**Cause:** RBAC enforcement - contributors cannot edit others' content

**Solutions:**
1. Ask an editor or admin to make the change
2. Request role upgrade from admin

### Bootstrap admin cannot log in

**Causes:**
1. KV entry not created
2. Password incorrect (case-sensitive)
3. Username doesn't match

**Solutions:**
1. Verify KV entry exists: Cloudflare > KV > LOON_DB > View entries
2. Check key is `user:yourusername`
3. Re-run bootstrap script if needed

### Session not persisting after refresh

**Causes:**
1. Using sessionStorage instead of localStorage
2. Token expired
3. Browser privacy settings

**Solutions:**
1. Check "Remember me" when logging in
2. Sessions expire after 24 hours
3. Check browser allows localStorage

---

## Getting Help

If your issue isn't listed here:

1. Check GitHub repository issues
2. Review ARCHITECTURE.md for system understanding
3. Open a new issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser and OS
   - Relevant error messages
