# Testing Checklist

Manual testing guide to verify LOON is working correctly.

---

## Prerequisites

Before testing, ensure:

- [ ] Repository deployed to Cloudflare Pages
- [ ] Environment variables set (`GITHUB_REPO`, `GITHUB_TOKEN`)
- [ ] For Phase 2: KV namespace `LOON_DB` created and bound

---

## Phase 1 Testing (Directory Mode)

### 1. Health Check

```bash
curl https://your-site.pages.dev/api/health
```

**Expected:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "mode": "directory",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": false
  }
}
```

### 2. Authentication (Phase 1)

```bash
curl -X POST https://your-site.pages.dev/api/auth \
  -H "Content-Type: application/json" \
  -d '{"pageId":"demo","password":"YOUR_PASSWORD"}'
```

**Expected:** `{"success":true,"pageId":"demo"}`

### 3. Save Content (Phase 1)

```bash
curl -X POST https://your-site.pages.dev/api/save \
  -H "Content-Type: application/json" \
  -d '{
    "pageId":"demo",
    "password":"YOUR_PASSWORD",
    "content":{"headline":"Test","status":"Active","body":"Hello"}
  }'
```

**Expected:** `{"success":true,"commit":"abc123..."}`

### 4. Admin UI (Phase 1)

1. Go to `https://your-site.pages.dev/admin.html`
2. Enter Page ID: `demo`
3. Enter Password: (your password)
4. Click Login
5. **Expected:** Form loads with fields from schema
6. Edit a field
7. Click Save
8. **Expected:** "Changes saved" message
9. Check GitHub repo for new commit

---

## Phase 2 Testing (Team Mode)

### 1. Health Check (with KV)

```bash
curl https://your-site.pages.dev/api/health
```

**Expected:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "mode": "team",
  "checks": {
    "github_repo": true,
    "github_token": true,
    "kv_database": true
  }
}
```

### 2. Bootstrap Admin

```bash
export CF_ACCOUNT_ID="your-id"
export CF_API_TOKEN="your-token"
export KV_NAMESPACE_ID="your-kv-id"

./scripts/bootstrap-admin.sh testadmin TestPassword123
```

**Expected:** Success message with credentials

### 3. Authentication (Phase 2)

```bash
curl -X POST https://your-site.pages.dev/api/auth-v2 \
  -H "Content-Type: application/json" \
  -d '{"username":"testadmin","password":"TestPassword123"}'
```

**Expected:**
```json
{
  "success": true,
  "token": "uuid-here",
  "role": "admin",
  "username": "testadmin",
  "expiresIn": 86400
}
```

Save the token for subsequent tests.

### 4. List Users (Admin)

```bash
curl https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:**
```json
{
  "users": [
    {"username": "testadmin", "role": "admin", "created": "..."}
  ]
}
```

### 5. Create User (Admin)

```bash
curl -X POST https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"editor1","role":"editor"}'
```

**Expected:**
```json
{
  "success": true,
  "username": "editor1",
  "password": "auto-generated",
  "role": "editor"
}
```

### 6. Save Content (Phase 2)

```bash
curl -X POST https://your-site.pages.dev/api/save-v2 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId":"demo",
    "content":{"headline":"Team Test","status":"Active","body":"Hello from team mode"}
  }'
```

**Expected:**
```json
{
  "success": true,
  "commit": "abc123...",
  "pageId": "demo",
  "modifiedBy": "testadmin"
}
```

### 7. RBAC Test (Contributor)

1. Create a contributor user
2. Log in as contributor
3. Create new content (should succeed)
4. Try to edit content created by admin (should fail with 403)

### 8. Logout

```bash
curl -X DELETE https://your-site.pages.dev/api/auth-v2 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:** `{"success":true,"message":"Logged out"}`

### 9. Admin UI (Phase 2)

1. Go to `https://your-site.pages.dev/admin-v2.html`
2. Enter Username: `testadmin`
3. Enter Password: `TestPassword123`
4. Click Login
5. **Expected:** Editor loads, role badge shows "admin"
6. Click "Manage Users" tab
7. **Expected:** User list displays
8. Create a new user
9. **Expected:** Password displayed, user appears in list
10. Edit content and save
11. **Expected:** Content saved with metadata

---

## Error Cases to Test

### Rate Limiting

```bash
# Run 6 times quickly
for i in {1..6}; do
  curl -X POST https://your-site.pages.dev/api/auth-v2 \
    -H "Content-Type: application/json" \
    -d '{"username":"bad","password":"wrong"}'
done
```

**Expected:** 6th request returns 429 "Too many login attempts"

### Invalid Session

```bash
curl -X POST https://your-site.pages.dev/api/save-v2 \
  -H "Authorization: Bearer invalid-token" \
  -H "Content-Type: application/json" \
  -d '{"pageId":"demo","content":{}}'
```

**Expected:** 401 "Invalid or expired session"

### Content Too Large

```bash
# Create a 2MB string
LARGE=$(python3 -c "print('x' * 2000000)")
curl -X POST https://your-site.pages.dev/api/save-v2 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pageId\":\"demo\",\"content\":{\"body\":\"$LARGE\"}}"
```

**Expected:** 413 "Content exceeds 1MB limit"

### Non-Admin User Management

```bash
# Login as editor/contributor
# Try to access /api/users
curl https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer EDITOR_TOKEN"
```

**Expected:** 403 "Admin access required"

### Page Listing API

```bash
# List all pages (no auth)
curl https://your-site.pages.dev/api/pages

# List pages with auth (contributor sees only own pages)
curl https://your-site.pages.dev/api/pages \
  -H "Authorization: Bearer CONTRIBUTOR_TOKEN"
```

**Expected:** JSON with `pages` array, `mode`, `canEditAll`, `total`

### Session Management

```bash
# List active sessions (admin only)
curl https://your-site.pages.dev/api/sessions \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Force logout user
curl -X DELETE https://your-site.pages.dev/api/sessions \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","all":true}'
```

**Expected:** Sessions list with `tokenPreview`, `username`, `role`, `ip`

### Password Change

```bash
curl -X PATCH https://your-site.pages.dev/api/auth-v2 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"old","newPassword":"newpass123"}'
```

**Expected:** `{"success":true,"message":"Password changed successfully"}`

### Content Deletion

```bash
# Delete content (admin/editor only)
curl -X DELETE https://your-site.pages.dev/api/content \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageId":"test-page"}'
```

**Expected:** `{"success":true,"message":"Content for \"test-page\" deleted","commit":"sha..."}`

**Note:** Contributors cannot delete (403)

---

## Verification Checklist

### Phase 1

- [ ] Health endpoint returns "ok" status
- [ ] Auth endpoint validates password
- [ ] Auth endpoint rejects wrong password
- [ ] Save endpoint commits to GitHub
- [ ] Save endpoint adds metadata
- [ ] Rate limiting works
- [ ] admin.html login works
- [ ] admin.html page browser works
- [ ] admin.html form renders from schema
- [ ] admin.html save works
- [ ] Public page displays content

### Phase 2

- [ ] Health endpoint shows "team" mode
- [ ] Bootstrap script creates admin
- [ ] Admin can login and get token
- [ ] Session verification works (GET /api/auth-v2)
- [ ] Token expires after 24 hours
- [ ] Admin can list users
- [ ] Admin can create users
- [ ] Admin can reset passwords
- [ ] Admin can delete users
- [ ] Editor can edit any content
- [ ] Contributor can create content
- [ ] Contributor cannot edit others' content
- [ ] Logout invalidates session
- [ ] admin-v2.html login works
- [ ] admin-v2.html shows role badge
- [ ] admin-v2.html user management works
- [ ] admin-v2.html page browser works
- [ ] admin-v2.html sessions tab works (admin)
- [ ] admin-v2.html password change works
- [ ] Password auto-upgrade works (bootstrap → hashed)
- [ ] Page listing filters for contributors
- [ ] Session revoke works
- [ ] Content deletion works (admin/editor)
- [ ] Contributor cannot delete content (403)

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| 500 "KV not configured" | LOON_DB not bound | Add KV binding in Cloudflare |
| 500 "GitHub not configured" | Missing env vars | Add GITHUB_REPO and GITHUB_TOKEN |
| 401 after working login | Session expired | Log in again (24h expiry) |
| 403 on save | RBAC denied | Check user role and content ownership |
| CORS errors | Missing headers | Check browser dev tools network tab |
