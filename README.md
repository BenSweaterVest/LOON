# LOON

**Lightweight Online Organizing Network**: a small content management system for food trucks, clubs, small businesses and community groups. Editors update pages in a browser; visitors get a fast static website. Everything runs on free plans from Cloudflare and GitHub.

- **Costs nothing.** Built for the Cloudflare Workers Free plan, D1's free tier and free GitHub. No paid services, and no card on file needed.
- **Fast, private drafts.** Drafts live in a database and are never public. Publishing writes static HTML, so public traffic never touches the API.
- **Safe by default.** HttpOnly session cookies, passkeys, a strict Content Security Policy, escaped Markdown, role-based access and an audit log.
- **Friendly editor.** 20 templates, live preview, image uploads resized in the browser, Word/OpenDocument import, page history with rollback, review workflow, scheduling.

## How it works

```text
Editors ──► /admin/ ──► /api/* (Pages Function) ──► D1: users, drafts, history, media
                                   │
                                   └─ on publish: one commit to content/ in GitHub
                                                        │
Visitors ◄── static HTML ◄── Cloudflare Pages build ◄───┘
```

Only `/api/*` runs code. Every public page is a static file, served without limit. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Set up (about 15 minutes, all in the browser)

You need a GitHub account and a Cloudflare account (both free).

1. **Create your repository.** On GitHub, use this repository as a template (**Use this template**). A public repository is simplest: it gets unlimited free Actions minutes for scheduled publishing. Private works too; see the note in [OPERATIONS.md](OPERATIONS.md#scheduled-publishing).

2. **Create a GitHub token.** GitHub > Settings > Developer settings > Fine-grained tokens > Generate new token.
   - Repository access: **Only select repositories**, pick your new repository.
   - Permissions: **Contents: Read and write**.
   - Copy the token.

3. **Create a D1 database.** Cloudflare dashboard > Storage & Databases > D1 > Create. Name it `loon`.

4. **Create the Pages project.** Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, and choose your repository.
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Under **Environment variables**, add:

   | Name | Value | Type |
   |---|---|---|
   | `GITHUB_REPO` | `your-name/your-repo` | Text |
   | `GITHUB_TOKEN` | the token from step 2 | Secret |
   | `SETUP_TOKEN` | a long random phrase you make up | Secret |
   | `CRON_SECRET` | another long random phrase (optional, for scheduling) | Secret |
   | `SITE_URL` | `https://your-project.pages.dev` (optional, for sitemap and link previews) | Text |
   | `NODE_VERSION` | `22` | Text |

   Save and deploy. The first deploy works but the editor needs the database, so:

5. **Bind the database.** In the Pages project: Settings > Bindings > Add > D1 database. Variable name **`DB`**, database `loon`. Then Deployments > latest deployment > **Retry deployment** so the binding takes effect.

6. **Create your admin account.** Open `https://your-project.pages.dev/admin/`, enter the `SETUP_TOKEN`, and choose a username and password.

That's it. Create a page, press **Publish**, and it appears on your site about a minute later.

**Optional:** turn on [scheduled publishing](OPERATIONS.md#scheduled-publishing), add a [custom domain](OPERATIONS.md#custom-domain), and download a [backup](OPERATIONS.md#backups) once you have content.

## Using LOON

| Role | Can do |
|---|---|
| Contributor | Create pages, edit their own, submit them for review |
| Editor | Edit and publish any page; manage media, blocks and feedback |
| Admin | Everything, plus users, site settings and system tools |

Pages are built from templates (menus, events, FAQs, job postings, status pages and more) or a blank page. Each template defines fields; the site layout comes from those fields automatically. Editors can adjust a page's fields with the visual field editor. See [docs/TEMPLATES.md](docs/TEMPLATES.md).

## Develop locally

Requires Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:8788/admin/ and use the setup token `local-setup-token`. This runs the real API in Cloudflare's local runtime with a local D1 database (stored in `.wrangler/`). Publishing updates the local database only, unless you set GitHub credentials in `.dev.vars` (see `.dev.vars.example`).

```bash
npm run validate
```

runs static checks, the test suite (against a real local D1) and a build. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [OPERATIONS.md](OPERATIONS.md): running a site, backups, scheduling, troubleshooting
- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit, and why
- [SECURITY.md](SECURITY.md): security model and reporting
- [docs/API.md](docs/API.md): HTTP API reference
- [docs/TEMPLATES.md](docs/TEMPLATES.md): field types and writing templates
- [CHANGELOG.md](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
