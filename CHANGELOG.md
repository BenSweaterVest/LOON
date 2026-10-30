# Changelog

All notable changes to LOON are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [2.0.0] - Unreleased

A ground-up rebuild. Version 2 is not compatible with 1.x installs: create a new D1 database and follow the README setup. Content from 1.x can be re-entered or copied into new pages.

### Why

- Drafts were publicly readable, because `content.json` (with the draft inside) was served as a static file.
- Unpublishing did not hide pages.
- Passkey endpoints did not route on Cloudflare Pages.
- The CSP blocked the admin's CDN libraries, and inline scripts required `unsafe-inline`.
- KV's free tier (1,000 writes a day) could be exhausted by a few active editors, and every draft save triggered a Pages build (500 a month).

### Added

- Cloudflare D1 for users, sessions, drafts, revision history, media, blocks, watches, feedback, settings, audit log and rate limits, with automatic migrations.
- Static site build: published pages render to HTML at build time. Public traffic uses no Function requests. Sitemap, canonical links, Open Graph tags, 404 page, dark mode.
- Schema-driven page renderer shared by the build and the admin's live preview.
- Field types: Markdown, repeating groups, lists, images, dates and times, choices and more (15 total), with validation on save and required-field checks on publish.
- Single-commit publishing through the Git Data API, including bulk publish.
- Optimistic version checks on save and publish, with a conflict dialog; local draft backups in the browser.
- Revision history with field-level comparison, restore to draft, and rollback of the live page.
- Review workflow (submit, withdraw, send back with a note) and scheduled publishing (cron endpoint, GitHub Action, and opportunistic runs).
- Media library: images resized and compressed in the browser, committed alongside the pages that use them.
- Document import into Markdown fields from Word, OpenDocument, HTML, Markdown and text files.
- Passkeys rebuilt on SimpleWebAuthn, with recovery codes that force a password change.
- Reusable blocks, watch list with an activity feed, reader feedback inbox, audit log viewer.
- Site settings: name, tagline, home page, navigation, footer, accent color, language.
- System page: configuration checks, GitHub write-access test, chunked backup download, restore during setup, republish everything from the database.
- `npm run dev` runs the real Functions with a local D1 through Wrangler.
- Tests run against a real D1 (Miniflare), a fake GitHub API and a software WebAuthn authenticator.

### Changed

- One catch-all Function (`functions/api/[[route]].js`) with a small router replaces 25 separate endpoint files.
- Sessions use `__Host-` HttpOnly, SameSite=Strict cookies; D1 stores only token hashes. Bearer tokens in localStorage are gone.
- Admin rebuilt as vanilla ES modules under a strict CSP; served from `/admin/`.
- Templates use one `template.json` each; menu, FAQ and team templates use repeating groups.
- Markdown is rendered by a built-in safe renderer (no raw HTML).
- Contributor isolation now also hides other people's pages from lists and history.

### Removed

- Cloudflare KV, the KV index and backup scripts, and the separate local-mode server.
- Cloudflare Images uploads (storage is a paid product).
- PDF import (heavy dependency, poor results); DOCX and ODT import remain.
- Bootstrap plaintext passwords and environment-variable user setup.
- CORS configuration (the API is same-origin only).
