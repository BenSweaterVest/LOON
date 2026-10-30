# Architecture

LOON has three parts: a static site, an admin app, and one Pages Function that serves the API. The guiding constraint is that a site must run indefinitely on free plans, so every design choice is measured against the free-tier limits below.

## Free-tier budget

| Resource | Free limit | How LOON stays inside it |
|---|---|---|
| Static requests (Pages) | Unlimited | All public pages are static files. `_routes.json` sends only `/api/*` to the Function. |
| Function requests | 100,000/day | Only editors and the feedback form call the API. |
| Function CPU | 10 ms per request | No heavy work per request. Images are resized and base64-encoded in the browser; the server only moves strings. |
| D1 | 5 GB, 5M rows read and 100k rows written per day | Indexed queries, one rate-limit row write per check, coalesced revision writes. |
| Pages builds | 500/month | Drafts never commit. Each publish, of any number of pages, is exactly one commit. |
| GitHub Actions | Unlimited (public) / 2,000 min (private) | One optional cron workflow, which calls the API and exits. |

When a free limit is reached, requests fail until the daily reset. Nothing is billed. LOON avoids R2 (needs a payment method on file) and Cloudflare Images storage (paid), and uses D1 instead of KV because KV's free tier allows only 1,000 writes a day.

**Password hashing and CPU.** PBKDF2-SHA256 at 100,000 iterations (the maximum Workers allows) takes roughly 20 ms of CPU, above the nominal 10 ms. Cloudflare tolerates occasional bursts, and logins are rare, but if sign-ins fail with error 1102 set `PBKDF2_ITERATIONS` lower (for example `50000`). Stored hashes record their iteration count and are upgraded or downgraded automatically at the next sign-in.

## Request flow

```text
Browser ─ GET /tacos/ ─────────────► dist/tacos/index.html (static, no Function)
Browser ─ /admin/ ─────────────────► dist/admin/* (static app)
Admin   ─ fetch /api/... ──────────► functions/api/[[route]].js
                                         └─ src/server/app.js
                                              route match
                                              CSRF origin check (non-GET)
                                              D1 migrations (first request per isolate)
                                              session cookie lookup
                                              role gate
                                              handler
```

## Code layout

```text
functions/api/[[route]].js   Pages Function entry; forwards to src/server/app.js
src/server/                  API: router, auth, D1 access, publishing
  routes/                    one module per area (pages, publishing, media, ...)
  db/schema.js               D1 schema and migrations (auto-applied)
  publish/github.js          Git Data API client (single-commit publishing)
  publish/publisher.js       publish, unpublish, schedule, republish
src/shared/                  runs in Workers, Node and the browser
  schema.js                  field types, schema and content validation
  markdown.js                safe Markdown renderer
  render.js                  page renderer (static build and live preview)
  site.js, page-id.js        settings and page ID rules
public/                      static files copied to dist/ (admin app, site CSS/JS)
templates/                   page templates (template.json each)
content/                     published content, written by LOON (do not hand-edit)
scripts/build.mjs            static site build (Pages build command)
scripts/dev.mjs              local dev server (Wrangler + local D1)
tests/                       Vitest suites against a real local D1 (Miniflare)
```

## Data

**D1** is the system of record for everything editable:

| Table | Holds |
|---|---|
| `users` | accounts, roles, PBKDF2 password hashes |
| `sessions` | SHA-256 of session tokens, expiry, device info |
| `passkeys`, `recovery_codes`, `challenges` | WebAuthn credentials, hashed one-time codes, single-use challenges |
| `pages` | draft (title, schema, data), version, workflow state, schedule, and a snapshot of the published version |
| `revisions` | last 50 versions per page (saves within ten minutes by one person are coalesced) |
| `media` | images as base64 text, with metadata |
| `blocks`, `watches`, `feedback`, `settings` | reusable snippets, watch list, reader feedback, site settings |
| `audit` | who did what, kept for `AUDIT_RETENTION_DAYS` (default 90) |
| `rate_limits` | fixed-window counters |

**GitHub** holds only what is public: `content/pages/<id>.json` (published snapshots), `content/media/*` (images used by published pages) and `content/site.json`. Git history doubles as a public change log. Because D1 also stores each published snapshot, **Republish all** can recreate `content/` from scratch.

## Publishing

1. The editor validates the draft against its schema, including required fields.
2. New images referenced by the page are collected from D1.
3. One commit is built with the Git Data API (blobs, tree, commit, ref update), retrying if the branch moved.
4. D1 records the published snapshot, version and commit.
5. Cloudflare Pages sees the commit and runs `npm run build`, which renders `content/` into `dist/`.

Unpublishing deletes the page file in one commit. Scheduled pages are published by `POST /api/cron` (called by the optional GitHub Action) and opportunistically whenever an editor loads the page list.

## Rendering

`src/shared/render.js` turns a page (schema + data) into HTML. Layout comes from the fields: a title-like field becomes the headline, a summary-like field the lede, a `status` choice a coloured badge, the first image the hero, `*_label`/`*_url` pairs become buttons, long text becomes sections, short values a details panel, and repeating groups become cards (with prices) or FAQ disclosures. The same module powers the admin's live preview, so the preview is exact.

Markdown is rendered by a small built-in renderer that escapes all HTML and allows only safe URLs, so no author can inject script into the public site.

## Concurrency

Each page has a version number. Saves send the version they started from; a mismatch returns `409` and the editor offers to load the newer version or save on top. Publishing can pin a version too, so an editor publishes exactly what they reviewed. Unsaved edits are also kept in the browser's local storage and offered back after a crash.

## Trade-offs

- Publishing takes about a minute (the Pages build). Previews are instant.
- One site per deployment. Run more sites by deploying more copies.
- Images are capped at 1.5 MB after in-browser resizing (D1 row limits and CPU budget).
- No real-time co-editing; version checks prevent lost updates instead.
