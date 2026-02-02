# User Onboarding Checklist

Step-by-step guide for administrators onboarding new content editors.

---

## Before You Start

Have ready:
- [ ] User's email address
- [ ] Which page type they need (e.g., food-truck, blog-post)
- [ ] Their page ID (lowercase, no spaces: `johns-truck`, `marketing-blog`)

---

## Step 1: Create User via Admin Panel

The easiest way to add users is through the web UI:

1. Log in to `/admin.html` as an admin
2. Click "Manage Users" tab
3. Click "Add New User"
4. Enter username and set temporary password
5. Click "Create User"

The new user can now log in and change their password.

---

## Step 2: Create Data Folder

Copy an appropriate example schema:

```bash
cp -r examples/<schema-type> data/<page-id>
```

Example:
```bash
cp -r examples/food-truck data/johns-truck
```

---

## Step 3: Customize Schema (Optional)

Edit `data/<page-id>/schema.json` if you need to:
- Change field labels
- Add/remove fields
- Modify dropdown options

---

## Step 4: Set Initial Content (Optional)

Edit `data/<page-id>/content.json` with starter content, or leave the example defaults.

---

## Step 5: Commit and Deploy

```bash
git add data/<page-id>
git commit -m "Add page for <user-name>"
git push
```

Wait ~60 seconds for Cloudflare to deploy.

---

## Step 6: Test Access

1. Go to `https://your-site.pages.dev/admin.html`
2. Enter the page ID
3. Enter the generated password
4. Verify you can see the editor

---

## Step 7: Send Credentials to User

Send a message (email, Slack, etc.) with:

```
Subject: Your LOON Editor Access

Hi [Name],

Your content editor account is ready.

Login URL: https://your-site.pages.dev/admin.html
Page ID: [page-id]
Password: [generated-password]

Quick start:
1. Go to the login URL
2. Enter your Page ID and Password
3. Edit the form fields
4. Click "Save Changes"
5. Your updates go live in about 60 seconds

Tips:
- Bookmark the login URL
- Use "Remember me" on your personal device
- Press Ctrl+S to save quickly
- Press ? to see keyboard shortcuts

User guide: [link to USER-GUIDE.md or PDF]

Questions? Contact [admin contact]

Thanks,
[Your name]
```

---

## Step 8: Verify User Can Access

- [ ] User confirms they can log in
- [ ] User makes a test edit
- [ ] Verify edit appears on public page

---

## Onboarding Checklist Template

Copy this for each new user:

```
User: ___________________
Email: ___________________
Page ID: ___________________
Page Type: ___________________
Date Created: ___________________

[ ] Credentials generated
[ ] Data folder created
[ ] Schema customized (if needed)
[ ] Initial content set (if needed)
[ ] Committed and pushed
[ ] Access tested by admin
[ ] Credentials sent to user
[ ] User confirmed access
[ ] User completed first edit
```

---

## Bulk Onboarding

For onboarding many users at once, use the bulk user creation script.

### 1. Create CSV file

Create a file (e.g., `new-users.csv`) with this format:

```csv
username,role,password
john,editor,
jane,contributor,custompass123
mike,contributor,
```

- First row must be the header
- Password is optional (auto-generated if empty)
- Valid roles: admin, editor, contributor

### 2. Run bulk script

```bash
export LOON_URL="https://your-site.pages.dev"
export LOON_ADMIN_TOKEN="your-admin-session-token"
./scripts/bulk-users.sh new-users.csv
```

### 3. Distribute credentials

The script creates `new-users.csv.results.csv` with all usernames and passwords:

```csv
username,role,password,status
john,editor,auto-gen-pass-123,created
jane,contributor,custompass123,created
```

Use this file to send credentials to users.

---

## Offboarding

When a user no longer needs access:

### Quick Deactivation

1. Log in to `/admin.html` as admin
2. Click "Manage Users"
3. Find the user to remove
4. Click "Delete"
5. Confirm deletion

The user's account is deactivated immediately. Data remains for archival.

### Full Removal (Optional)

If you want to also delete their page content:

```bash
rm -rf data/<page-id>
git add -A
git commit -m "Remove <page-id>"
git push
```

### Offboarding Checklist

- [ ] Confirm user should be removed
- [ ] Backup their content (if needed)
- [ ] Remove via Admin Panel
- [ ] Delete data folder (if full removal)
- [ ] Commit and push (if removing data)
- [ ] Notify user their access has ended
