# LOON v3.1.0 Implementation Guide

**Date**: February 2, 2026  
**Version**: 3.1.0  
**Status**: Production-ready

---

## Overview

This guide documents the four features implemented in v3.1.0:

1. **KV-Only Authentication** - Users stored in Cloudflare KV (no environment variables)
2. **Draft/Publish Workflow** - Content stages before going live
3. **Image Upload Management** - Cloudflare Images integration
4. **JSON Schema Support** - Industry-standard schema format

---

## Feature 1: KV-Only Authentication

### What Changed

**Previous Model (Phase 1)**:
- User passwords stored in environment variables (`USER_{PAGEID}_PASSWORD`)
- Limited to ~95 users due to env var constraints
- Tightly coupled to page IDs

**Current Model (v3.1.0)**:
- All users stored in Cloudflare KV `LOON_DB` namespace
- Unlimited users
- Users can manage multiple pages
- Passwords hashed with PBKDF2 (100,000 iterations)
- Session tokens are UUIDs with 24-hour expiry

### Migration (If Upgrading)

If you have Phase 1 users in environment variables:

```bash
# Set up Cloudflare API access
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
export KV_NAMESPACE_ID="your-kv-namespace-id"

# Run migration script
node scripts/migrate-phase1-to-phase2.js
```

The script will:
1. Scan for `USER_*_PASSWORD` environment variables
2. Create KV user records with random passwords
3. Output new credentials to share with users

### Setup Steps

1. **Create KV Namespace**
   - Cloudflare Dashboard → KV Namespaces
   - Create new namespace: `LOON_DB`

2. **Bind to Pages Project**
   - Pages → Your Project → Settings → Functions
   - Add KV namespace binding: `LOON_DB`

3. **Create First Admin User**
   ```bash
   ./scripts/bootstrap-admin.sh admin MySecurePassword123
   ```

4. **Deploy**
   - Trigger redeploy in Cloudflare Pages

### Technical Details

**User Record (KV)**:
```json
{
  "username": "admin",
  "role": "admin",
  "hash": "pbkdf2(password)",
  "salt": "random-16-char-salt",
  "created": "2026-02-02T10:00:00Z",
  "modified": "2026-02-02T10:00:00Z",
  "bootstrap": false
}
```

**Session Record (KV, 24h TTL)**:
```json
{
  "username": "admin",
  "role": "admin",
  "created": "2026-02-02T10:00:00Z",
  "ip": "1.2.3.4"
}
```

---

## Feature 2: Draft/Publish Workflow

### What Changed

**Content Structure**:
```json
{
  "draft": {
    "title": "My Draft Post",
    "body": "This is not yet published..."
  },
  "published": {
    "title": "My Published Post",
    "body": "This is live content"
  },
  "_meta": {
    "status": "draft" | "published",
    "createdBy": "username",
    "created": "2026-02-02T10:00:00Z",
    "modifiedBy": "username",
    "lastModified": "2026-02-02T11:00:00Z",
    "publishedBy": "admin",
    "publishedAt": "2026-02-02T12:00:00Z"
  }
}
```

**New API Endpoints**:
- `POST /api/save` with `{ "saveAs": "draft" }` - Save as draft only
- `POST /api/publish` with `{ "pageId": "...", "action": "publish" }` - Publish draft
- `POST /api/publish` with `{ "action": "unpublish" }` - Unpublish content

### Admin UI Changes

**Buttons and Status** (in admin.html):
- **Save Changes**: direct save (admins/editors only)
- **Save as Draft**: saves draft only (all roles)
- **Publish**: promotes draft to published (admins/editors only)
- **Status banner**: shows draft vs published state

**Server-side enforcement**:
- Contributors are forced to draft saves even if a direct save is attempted

**JavaScript Functions** (already integrated in admin.html):
- `saveContentAsDraft()`
- `publishContent()`
- `updateContentStatus()`

**Public Frontend** (update index.html or your loader):
```javascript
// Only load published content
async function loadContent(pageId) {
  const res = await fetch(`/data/${pageId}/content.json`);
  const fullData = await res.json();

  // Use published version for public site (fallback for legacy content)
  const content = fullData.published || fullData.draft || fullData;

  // If only a draft exists, show a "not published" message
  if (fullData.published === undefined && fullData.draft && fullData._meta?.status !== 'published') {
    return null;
  }

  return content;
}
```

### Permissions

| Role | Save Draft | Publish | Unpublish |
|------|------------|---------|-----------|
| Admin | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ |
| Contributor | ✅ | ❌ | ❌ |

**Contributors** must save as draft and request an Editor/Admin to publish.

---

## Feature 3: Basic Media Management

### What Changed

**New API Endpoint**: `/api/upload`

**Environment Variables Required**:
```
CF_ACCOUNT_ID=your-cloudflare-account-id
CF_IMAGES_TOKEN=your-cloudflare-images-api-token
```

### Setup: Cloudflare Images

#### Step 1: Get Account ID

1. Go to Cloudflare Dashboard
2. Click on any site
3. Account ID is on the right sidebar → Copy it

#### Step 2: Create API Token

1. Cloudflare Dashboard → My Profile → API Tokens
2. Create Token → "Create Custom Token"
3. Permissions:
   - **Account** → **Cloudflare Images** → **Edit**
4. Account Resources: Include → Your Account
5. Click "Continue to summary" → "Create Token"
6. Copy the token (starts with a long string)

#### Step 3: Add Environment Variables

Cloudflare Pages → Settings → Environment variables → Production:
- `CF_ACCOUNT_ID` = `your-account-id`
- `CF_IMAGES_TOKEN` = `your-api-token` (mark as Secret)

### Admin UI Changes

**New Schema Field Type**: `image`

**Example Schema** (`schema.json`):
```json
{
  "title": "Blog Post",
  "fields": [
    {
      "key": "featuredImage",
      "label": "Featured Image",
      "type": "image",
      "required": false
    }
  ]
}
```

**Admin UI behavior** (in admin.html):
- `image` fields render an **Upload Image** button and preview
- Uploads call `/api/upload` and store the returned URL in the field
- Existing images show a preview; button text changes to **Change Image**
- Uploads enforce the 10MB size limit and image-only file types

### Image Usage in Content

**Saved Content**:
```json
{
  "featuredImage": "https://imagedelivery.net/{account}/abc123/public"
}
```

**Display in Frontend**:
```html
<img src="<%= content.featuredImage %>" alt="Featured image">
```

**Responsive Images** (use variants):
```html
<picture>
    <source srcset="<%= content.featuredImage.replace('/public', '/large') %>" media="(min-width: 1024px)">
    <source srcset="<%= content.featuredImage.replace('/public', '/medium') %>" media="(min-width: 768px)">
    <img src="<%= content.featuredImage.replace('/public', '/thumbnail') %>" alt="Featured image">
</picture>
```

### Cost Considerations

**Cloudflare Images Free Tier**:
- 100,000 images stored
- Unlimited transformations
- Unlimited delivery

**Paid Plans** (if you exceed):
- $5/month for 100,000 additional images
- $1/month per 100,000 images delivered

**For most users**: Free tier is sufficient

---

## Feature 4: JSON Schema Standard

### What Changed

**Old Schema Format** (custom LOON format):
```json
{
  "title": "Blog Post",
  "description": "A simple blog post",
  "fields": [
    {
      "key": "title",
      "label": "Post Title",
      "type": "text",
      "required": true
    }
  ]
}
```

**New Schema Format** (JSON Schema standard):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Blog Post",
  "description": "A simple blog post",
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "title": "Post Title"
    }
  },
  "required": ["title"]
}
```

### Benefits

- **IDE Support**: VS Code autocomplete and validation
- **Validation Libraries**: Use `ajv` or other standard validators
- **Portability**: Import/export to other systems
- **Advanced Features**:
  - Conditional fields (`if/then/else`)
  - Pattern matching (`pattern`, `format`)
  - Enum values
  - Number ranges (`minimum`, `maximum`)
  - Array validation (`items`, `minItems`, `maxItems`)

### Migration

**Automatic Conversion**:

```javascript
// Use the schema-validator utility
import { convertToJsonSchema } from './functions/lib/schema-validator.js';

const oldSchema = {
  title: "Blog Post",
  fields: [
    { key: "title", type: "text", required: true }
  ]
};

const newSchema = convertToJsonSchema(oldSchema);
console.log(JSON.stringify(newSchema, null, 2));
```

done
**Manual Migration (optional)**:
- You can run a small Node script that imports `convertToJsonSchema()` and rewrites your `schema.json` files.
- No built-in conversion script is included; the utility is ready for integration in your own tooling.

### Validation in Save Endpoint

**Update save.js (optional)**:
```javascript
import { validate } from '../lib/schema-validator.js';

// ... in onRequestPost handler

// Validate content against schema
const schemaPath = `data/${sanitizedPageId}/schema.json`;
const schemaFile = await fetchGitHubFile(env, schemaPath);

if (schemaFile.exists) {
    const validation = validate(content, schemaFile.content);
    
    if (!validation.valid) {
        return jsonResponse({
            error: 'Validation failed',
            errors: validation.errors
        }, 400, env, request);
    }
}
```

---

## Testing Checklist

### Unified Auth Migration
- [ ] Run migration script successfully
- [ ] All Phase 1 users converted to KV
- [ ] Users can log in with new credentials
- [ ] Users can change their passwords
- [ ] Role assignments correct (all Contributors)

### Draft/Publish Workflow
- [ ] "Save Draft" button saves without publishing
- [ ] "Publish" button requires confirmation
- [ ] Contributors cannot publish (button hidden/disabled)
- [ ] Admins/Editors can publish
- [ ] Public site shows only published content
- [ ] Draft content not visible on public site

### Media Management
- [ ] Upload button appears in admin panel
- [ ] Can upload JPEG, PNG, GIF, WebP
- [ ] Files >10MB rejected
- [ ] Image URL populated in form field
- [ ] Image preview shown after upload
- [ ] Uploaded images persist in Cloudflare Images

### JSON Schema
- [ ] Old schemas converted successfully
- [ ] Validation catches invalid content
- [ ] Required fields enforced
- [ ] Type checking works (string, number, boolean)
- [ ] Format validation (email, URL) works

---

## Rollback Plan

If issues arise:

### Unified Auth
```bash
# Restore Phase 1 users via environment variables
# Add back USER_{PAGEID}_PASSWORD variables
# Revert to previous version without migration
```

### Draft/Publish
```bash
# Content still has direct structure
# Old clients ignore draft/published fields
# Gracefully degrades to direct editing
```

### Media Management
```bash
# Remove CF_ACCOUNT_ID and CF_IMAGES_TOKEN
# Upload endpoint returns 503 (not configured)
# Users paste external image URLs instead
```

### JSON Schema
```bash
# Keep old schemas in schema.legacy.json
# Restore if conversion fails
# Validation is optional, can be disabled
```

---

## Deployment

```bash
# 1. Commit all changes
git add .
git commit -m "feat: v3.1.0 - Unified auth, draft/publish, media, JSON Schema"

# 2. Tag release
git tag v3.1.0

# 3. Push to GitHub (auto-deploys to Cloudflare Pages)
git push origin main --tags

# 4. Verify deployment (2-3 minutes)
# - Check admin.html loads
# - Test login
# - Test draft saving
# - Test image upload
# - Test schema validation
```

---

## Support

For issues during implementation:
- Check Cloudflare Pages deployment logs
- Review browser console for JavaScript errors
- Test API endpoints with curl/Postman
- Verify environment variables set correctly

---

**Status**: ✅ Ready for production deployment  
**Estimated Implementation Time**: 2-3 hours (including migration and testing)
