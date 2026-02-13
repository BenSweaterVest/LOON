# Local Mode

Use this to run LOON locally without Cloudflare or GitHub. The local server writes content directly into the project's data/ folder, so changes persist and can be pushed later.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local server:
   ```bash
   npm run local
   ```
3. Open:
   - Admin: http://localhost:8787/admin.html
   - Site: http://localhost:8787/index.html?page=welcome
4. Log in with:
   - Username: `local`
   - Password: `local`

## What This Mode Does
- Stores page content in data/ (tracked in git).
- Seeds example pages from examples/ if data/ is empty.
- Mimics key API endpoints for editing, saving, and publishing.

## Limits
- Local mode does not publish to GitHub.
- File uploads are disabled.
- Revision history, audit logs, and session data are persisted locally in data/.local (ignored by git).

## Optional Settings
- Change the port with LOCAL_PORT:
  ```bash
  LOCAL_PORT=9000 npm run local
  ```
