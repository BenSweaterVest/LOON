# Project LOON
Lightweight Online Organizing Network. A serverless micro-CMS that runs on Cloudflare Pages with content stored in GitHub.

## Quick Start (Local Mode)
```bash
npm install
npm run local
```
- Admin: http://localhost:8787/admin.html
- Site: http://localhost:8787/index.html?page=welcome
- Login: `local` / `local`

Details and limits: [docs/LOCAL_MODE.md](docs/LOCAL_MODE.md)

## Production Setup (Summary)
1. Create a new repo from this template.
2. Create a Cloudflare Pages project connected to the repo.
3. Create and bind a KV namespace named `LOON_DB`.
4. Set environment variables:

| Variable | Value |
|----------|-------|
| `GITHUB_REPO` | `owner/repo` |
| `GITHUB_TOKEN` | Fine-grained token with Contents read/write (Secret) |
| `SETUP_TOKEN` | One-time setup token (Secret) |
| `RP_ID` | Hostname (optional for passkeys) |
| `RP_ORIGIN` | Full origin (optional for passkeys) |

5. Deploy, then open `/admin.html` to complete Initial Setup.

## Admin Workflow
- Create pages in the admin UI with templates or blank schemas.
- Save drafts, then publish when ready.
- Use Batch Session Mode to stage multiple edits before pushing.

## Local Development
```bash
npm install
npm run dev
```
Open http://localhost:8788.

## Tests
```bash
npm test
```

## Documentation
- [docs/README.md](docs/README.md) (index)
- [docs/API.md](docs/API.md)
- [docs/PASSKEYS_GUIDE.md](docs/PASSKEYS_GUIDE.md)
- [OPERATIONS.md](OPERATIONS.md)
- [SECURITY.md](SECURITY.md)

## License
MIT. See [LICENSE](LICENSE).
