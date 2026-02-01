# Phase 2: Team Mode Setup Guide

This guide walks you through upgrading LOON from "Directory Mode" (isolated users with passwords) to "Team Mode" (hierarchical team with roles).

---

## Overview

| Feature | Phase 1 (Directory) | Phase 2 (Team) |
|---------|---------------------|----------------|
| Auth Storage | Environment Variables | Cloudflare KV |
| User Limit | ~95 | Unlimited |
| Authentication | Password per page | Session tokens |
| Authorization | Page isolation | Role-based (RBAC) |
| User Management | CLI script | Admin UI + API |

### Roles in Team Mode

| Role | Permissions |
|------|-------------|
| **Admin** | Edit any content, manage users, full access |
| **Editor** | Edit any content |
| **Contributor** | Create content, edit only their own content |

---

## Prerequisites

- Existing LOON Phase 1 deployment working
- Cloudflare account with Workers KV access (free tier includes 100K reads/day)

---

## Step 1: Create KV Namespace

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **KV**
2. Click **Create a namespace**
3. Name it: `LOON_DB`
4. Click **Add**
5. Copy the **Namespace ID** (you'll need this)

---

## Step 2: Bind KV to Pages

1. Go to **Workers & Pages** → **Your LOON Project**
2. Go to **Settings** → **Functions** → **KV namespace bindings**
3. Click **Add binding**
4. Configure:
   - **Variable name**: `LOON_DB` (must be exact)
   - **KV namespace**: Select `LOON_DB`
5. Click **Save**

---

## Step 3: Bootstrap First Admin

Since the database is empty, you need to create the first admin user via script.

### Set environment variables

```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
export KV_NAMESPACE_ID="your-namespace-id"
```

### Run bootstrap script

```bash
./scripts/bootstrap-admin.sh admin YourSecurePassword123
```

### Verify

The script will output the credentials. Save them securely.

---

## Step 4: Update API Endpoints

Phase 2 uses new API endpoints to avoid breaking Phase 1:

| Endpoint | Purpose |
|----------|---------|
| `/api/auth-v2` | Login with username/password, get session token |
| `/api/save-v2` | Save content with session token + RBAC |
| `/api/users` | Admin user management |

The original `/api/auth` and `/api/save` continue to work for Phase 1 users.

---

## Step 5: Use the Team Mode Admin UI

A dedicated Team Mode admin panel is provided:

```
/admin-v2.html    # Team Mode (sessions, RBAC, user management)
/admin.html       # Phase 1 Mode (password per page)
```

### Features of admin-v2.html

- **Session-based login**: Uses `/api/auth-v2` for authentication
- **Role display**: Shows your role (Admin/Editor/Contributor)
- **User Management tab**: Admins can create, delete, and reset passwords
- **RBAC enforcement**: Contributors can only edit their own content
- **Metadata display**: Shows who created/modified content

### Switching from Phase 1

If you were using `admin.html`, simply:

1. Navigate to `/admin-v2.html`
2. Log in with your username and password (created via bootstrap script)
3. Use the new Team Mode features

---

## Step 6: Managing Users

### Via API (programmatic)

```bash
# List users
curl -X GET https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Create user
curl -X POST https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "jane", "role": "editor"}'

# Reset password
curl -X PATCH https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "jane", "resetPassword": true}'

# Delete user
curl -X DELETE https://your-site.pages.dev/api/users \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "jane"}'
```

### Via Admin UI (future)

A dedicated user management UI can be built using the `/api/users` endpoint.

---

## Migration Strategy

### Option A: Fresh Start (Recommended for new projects)

1. Set up Phase 2 from scratch
2. Create users via bootstrap/API
3. Use only `-v2` endpoints

### Option B: Gradual Migration (Existing Phase 1 users)

1. Keep Phase 1 endpoints active
2. Add Phase 2 endpoints alongside
3. Migrate users one at a time
4. Eventually deprecate Phase 1

### Option C: Hybrid Mode

Run both modes simultaneously:
- Directory users use `/api/auth` + `/api/save` (password-per-page)
- Team users use `/api/auth-v2` + `/api/save-v2` (session tokens)

---

## Security Considerations

### Password Storage

Phase 2 uses PBKDF2 with 100,000 iterations for password hashing. Bootstrap users are automatically upgraded to secure hashes on first login.

### Session Tokens

- Tokens are UUIDs (128-bit random)
- Stored in KV with 24-hour TTL
- Automatically expire

### Rate Limiting

- Login: 5 attempts per minute per IP
- Save: 30 requests per minute per IP

---

## Troubleshooting

### "KV not configured"

The `LOON_DB` binding is missing. Check:
1. KV namespace exists
2. Binding is added in Pages settings
3. Variable name is exactly `LOON_DB`

### "Invalid or expired session"

Session tokens expire after 24 hours. Log in again.

### "Contributors can only edit content they created"

The content's `_meta.createdBy` doesn't match the logged-in user. This is expected RBAC behavior.

### Bootstrap user can't log in

1. Verify the KV entry exists: check Cloudflare dashboard → KV
2. Password is case-sensitive
3. Username is lowercase

---

## KV Data Structure

```
user:username     → { role, hash, salt, created, createdBy, ... }
session:token     → { username, role, created, ip } [TTL: 24h]
```

---

## Costs

Cloudflare KV free tier includes:
- 100,000 reads/day
- 1,000 writes/day
- 1 GB storage

This is sufficient for most LOON deployments. A typical day might use:
- ~50 reads (logins + session validations)
- ~20 writes (logins creating sessions)

---

## Next Steps

After Phase 2 is working:

1. **Build Admin UI** - User management interface
2. **Add audit logging** - Track all changes to KV
3. **Implement password requirements** - Enforce complexity
4. **Add 2FA** - For admin accounts (future phase)
