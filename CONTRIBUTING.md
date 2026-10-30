# Contributing

Thanks for helping. LOON aims to stay small, dependable and free to run.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

The admin is at http://localhost:8788/admin/ (setup token `local-setup-token`). The dev server rebuilds when files in `public/`, `src/shared/`, `templates/` or `content/` change. Changes to `src/server/` are picked up by Wrangler automatically.

## Before opening a pull request

```bash
npm run validate
```

This runs `npm run check` (syntax, JSON, template validation and CSP rules), `npm test` (Vitest against a real local D1 through Miniflare) and `npm run build`.

## Ground rules

- **Free tier first.** No paid services. Keep per-request CPU low (the Workers Free plan allows about 10 ms): do heavy work in the browser or at build time. Keep D1 writes modest and never commit drafts to GitHub.
- **No inline scripts or styles** in `public/`. The CSP forbids them and `npm run check` enforces it. Build admin UI with the `h()` helper in `public/admin/js/dom.js`, never `innerHTML`.
- **Shared code stays portable.** `src/shared/` runs in Workers, Node and browsers: no Node APIs, no dependencies.
- **Tests with behavior changes.** API tests use `tests/helpers.js` (real D1, cookie-aware client) and `tests/fake-github.js` for publishing.
- **Schema changes are append-only.** Add a new migration to `src/server/db/schema.js`; never edit one that has shipped.
- **Docs with setup changes.** Update README, OPERATIONS or docs/API.md in the same pull request.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md#code-layout).

## Adding a template

Add `templates/<name>/template.json` and list it in `templates/index.js`. See [docs/TEMPLATES.md](docs/TEMPLATES.md).

## License

Contributions are licensed under MIT.
