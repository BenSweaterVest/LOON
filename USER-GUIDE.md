# User Guide

A guide for content editors using Project LOON.

---

## Which Mode Are You Using?

LOON has two modes. Ask your administrator which one applies to you:

| Mode | Login With | Admin URL |
|------|------------|-----------|
| **Directory Mode** (Phase 1) | Page ID + Password | `/admin.html` |
| **Team Mode** (Phase 2) | Username + Password | `/admin.html` |

Most of this guide applies to both modes. Differences are noted where relevant.

---

## Getting Started

### What You Need

**Directory Mode (Phase 1):**
1. **Page ID** - Provided by your administrator (e.g., `demo`, `tacos`)
2. **Password** - A unique password for your page

**Team Mode (Phase 2):**
1. **Username** - Your personal username
2. **Password** - Your account password
3. **Role** - Your permission level (Admin, Editor, or Contributor)

### Logging In

**Directory Mode:**
1. Go to: `https://your-site.pages.dev/admin.html`
2. Enter your **Page ID** (lowercase), or click **Browse** to see available pages
3. Enter your **Password**
4. Click **Sign In**

**Team Mode:**
1. Go to: `https://your-site.pages.dev/admin.html`
2. Enter your **Username**
3. Enter your **Password**
4. Click **Login**
5. Enter the **Page ID** you want to edit, or click **Browse Pages** to see available pages
   - Contributors: You'll see pages you created
   - Editors/Admins: You'll see all pages

### Staying Logged In

Check **"Remember me"** to stay signed in. 
- Directory Mode: 7 days
- Team Mode: 24 hours (session token expires)

Only use this on your personal device, not shared computers.

---

## Editing Content

### The Editor Interface

After logging in, you'll see a form with fields to edit. Each field has:
- **Label** - What the field is for
- **Input** - Where you type or select
- **Description** - Additional help (shown below some fields)
- **Required indicator** - Red asterisk (*) means you must fill this in

### Field Types

| Field | How to Use |
|-------|------------|
| **Text** | Type a single line of text |
| **Text area** | Type multiple lines (press Enter for new lines) |
| **Dropdown** | Click and select from options |
| **Checkbox** | Click to toggle on/off |
| **Date** | Click to open calendar picker |
| **Time** | Click to select time |
| **Email** | Enter an email address |
| **Phone** | Enter a phone number |
| **URL** | Enter a web address (starts with https://) |

### Character Limits

Some fields show a counter like `45/200`. This means:
- You've typed 45 characters
- Maximum allowed is 200 characters

The counter changes color as you approach the limit:
- **Normal** - Plenty of room
- **Yellow** - Getting close (70%+)
- **Red** - Almost full (90%+)

---

## Saving Your Work

### Manual Save

Click **Save Changes** or press `Ctrl+S` (Windows) or `Cmd+S` (Mac).

You'll see a confirmation message when saved successfully.

### Auto-Save (Drafts)

Your work is automatically saved to your browser every 30 seconds. This protects you if:
- You accidentally close the browser
- Your internet disconnects
- Your computer crashes

When you log in again, you'll be asked if you want to restore your draft.

**Note:** Drafts are only saved on the device you're using. They're not published until you click Save.

### When Changes Go Live

After saving:
1. Changes are sent to the server
2. The website rebuilds automatically
3. Changes appear publicly in about **60 seconds**

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save changes |
| `Escape` | Sign out |
| `?` | Show help (this shortcut list) |

---

## Viewing Your Page

Click **Preview** to open your public page in a new tab.

If you just saved, you may need to:
1. Wait 60 seconds for changes to publish
2. Refresh the page (`Ctrl+R` or `Cmd+R`)

---

## Signing Out

Click **Sign Out** in the top right corner.

If you have unsaved changes, you'll be asked to confirm.

---

## Dark Mode

The admin panel automatically matches your device's dark/light mode setting. No configuration needed.

---

## Tips

### Images

If you need to add images:
1. Upload your image to a service like Imgur, Google Drive (public), or your website
2. Copy the image URL (should end in .jpg, .png, etc.)
3. Paste the URL into the image field

The editor will show a preview if the URL is valid.

### Multiple Lines

In text area fields, press **Enter** to create new lines. Your line breaks will appear on the public page.

### Special Characters

You can use standard punctuation and special characters. Avoid using code or HTML tags.

---

## Changing Your Password

*This section only applies to Team Mode (Phase 2).*

1. Log in to the admin panel
2. Click the **My Account** tab
3. Enter your current password
4. Enter your new password (minimum 8 characters)
5. Confirm your new password
6. Click **Change Password**

Your password is changed immediately. Use the new password next time you log in.

---

## Team Mode: Understanding Roles

*This section only applies to Team Mode (Phase 2).*

### Role Permissions

| Role | What You Can Do |
|------|-----------------|
| **Contributor** | Create new content, edit your own content |
| **Editor** | Edit any content, delete content |
| **Admin** | Edit any content, delete content, manage users |

### Content Ownership

In Team Mode, content tracks who created it. Contributors can only edit content they created. If you try to edit someone else's content, you'll see a "Permission Denied" error.

### Viewing Your Role

After logging in, your role is displayed next to your username (e.g., "admin" badge).

---

## Common Questions

### I forgot my password

Contact your administrator. They can reset your password using the admin script.

### My changes aren't showing up

1. Wait 60 seconds after saving
2. Refresh the public page (hard refresh: `Ctrl+Shift+R`)
3. Check that the save was successful (look for green confirmation message)

### I accidentally deleted content

Don't panic. All changes are tracked:
1. Contact your administrator
2. They can restore previous versions from Git history

### Can I edit from my phone?

Yes. The admin panel is mobile-friendly. For the best experience:
- Use landscape mode for more space
- Tap fields to open the keyboard
- Scroll to see all fields

### Can two people edit at the same time?

Not recommended. The last person to save will overwrite the other's changes. Coordinate with your team about who is editing when.

---

## Getting Help

If you're stuck:
1. Check with your administrator
2. Review the error message (it often explains the problem)
3. Try signing out and back in
4. Clear your browser cache and try again
