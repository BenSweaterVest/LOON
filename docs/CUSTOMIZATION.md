# Customization Guide

How to customize the look and feel of your LOON site.

---

## Public Page (`index.html`)

The public page is fully customizable HTML. Edit it directly to match your brand.

### Changing Colors

Find the CSS variables in the `<style>` section:

```css
:root {
    --primary: #003865;      /* Main brand color */
    --primary-light: #004d8f;
    --accent: #667eea;       /* Accent/gradient color */
}
```

### Changing the Layout

The default layout shows:
1. Header with title
2. Content card with status badge
3. Body text
4. Metadata footer

Modify the `loadContent()` function to change what's displayed.

### Adding Your Logo

Replace the header:

```html
<header class="page-header">
    <img src="https://your-logo-url.com/logo.png" alt="Logo" style="max-width: 200px;">
    <h1>Your Site Name</h1>
</header>
```

### Multiple Page Types

For sites with different page types (e.g., food trucks vs. events), create separate HTML files:

```
index.html          # Default/home
trucks.html         # Food truck listing
events.html         # Events listing
```

Each can fetch from different data folders.

---

## Admin Page (`admin.html`)

### Changing Branding

Update the header:

```html
<h1>Your Company Admin <span class="version-badge">v1.0</span></h1>
<p>Content Management System</p>
```

### Custom Colors

Modify the CSS variables:

```css
:root {
    --primary: #your-color;
    --primary-hover: #your-hover-color;
}
```

### Removing Features

To remove features you don't need:

**Remove "Remember Me":**
Delete the `.remember-me` HTML and related JavaScript.

**Remove Dark Mode:**
Remove the `@media (prefers-color-scheme: dark)` CSS block.

---

## Custom Domains

Cloudflare Pages supports custom domains on the free tier.

### Setup Steps

1. Go to Cloudflare Pages → Your Project → Custom domains
2. Click "Set up a custom domain"
3. Enter your domain (e.g., `cms.yoursite.com`)
4. Add the DNS records Cloudflare provides
5. Wait for SSL certificate (automatic, ~15 minutes)

### Apex Domain vs Subdomain

- **Subdomain** (recommended): `cms.yoursite.com` - easier setup
- **Apex domain**: `yoursite.com` - requires DNS at Cloudflare

---

## Themes

### Creating a Theme

1. Copy `index.html` to `themes/your-theme.html`
2. Customize colors, layout, fonts
3. Test locally
4. Replace `index.html` with your theme

### Theme Ideas

**Minimal:**
- Remove gradients, use flat colors
- Reduce padding and margins
- Use system fonts

**Dark:**
- Dark background, light text
- Neon accent colors
- Good for tech/gaming

**Corporate:**
- Professional blues/grays
- Serif fonts for headings
- Structured, formal layout

---

## Multi-Language Support

LOON doesn't have built-in i18n, but you can implement it:

### Option 1: Separate Pages

Create language-specific folders:

```
data/
├── en/
│   └── home/
│       ├── schema.json
│       └── content.json
├── es/
│   └── home/
│       ├── schema.json
│       └── content.json
```

### Option 2: Language Field in Schema

Add language as a content field:

```json
{
  "fields": [
    { "key": "title_en", "label": "Title (English)", "type": "text" },
    { "key": "title_es", "label": "Title (Spanish)", "type": "text" }
  ]
}
```

### Option 3: Separate Sites

Deploy multiple LOON instances:
- `en.yoursite.com`
- `es.yoursite.com`

---

## Advanced: Custom Fields

### Adding a New Field Type

1. Edit `admin.html`
2. Find the `buildForm()` function
3. Add your type to the type handling:

```javascript
} else if (field.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
}
```

4. Update `gatherFormData()` if special handling needed

### Example: Star Rating Field

```javascript
// In buildForm()
} else if (field.type === 'rating') {
    input = document.createElement('select');
    for (let i = 1; i <= 5; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = '★'.repeat(i) + '☆'.repeat(5-i);
        input.appendChild(opt);
    }
}
```

---

## CSS Framework Alternatives

The default uses Pico CSS. You can swap it:

### Tailwind CSS

```html
<script src="https://cdn.tailwindcss.com"></script>
```

Then use Tailwind classes in your HTML.

### Bootstrap

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css" rel="stylesheet">
```

### No Framework

Remove the Pico CSS link and write custom CSS.

---

## Performance Optimization

### Minimize Rebuilds

Content changes (JSON) trigger rebuilds. To minimize:

1. Batch content updates when possible
2. Use the preview before saving
3. Consider client-side rendering (current default)

### Caching

The `_headers` file controls caching:

```
/data/*
  Cache-Control: no-cache, must-revalidate
```

For higher-traffic sites, consider:

```
/data/*
  Cache-Control: public, max-age=60
```

This caches content for 60 seconds, reducing origin hits.

---

## Webhooks & Integrations

### GitHub Actions on Content Change

Create `.github/workflows/on-content-change.yml`:

```yaml
name: Content Changed
on:
  push:
    paths:
      - 'data/**/content.json'

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send notification
        run: |
          curl -X POST ${{ secrets.WEBHOOK_URL }} \
            -d '{"text": "Content updated in LOON"}'
```

### Slack Notification

Use a Slack incoming webhook in the action above.

### Email Notification

Use a service like SendGrid or Mailgun in the GitHub Action.
