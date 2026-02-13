# Changelog

All notable changes to Project LOON will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public feedback API documentation in `docs/API.md` (`POST /api/feedback`).
- Automated test coverage for feedback endpoint behavior in `tests/feedback.test.js`.

### Changed
- Hardened `functions/api/feedback.js` input validation:
  - Enforces sanitized `pageId` format.
  - Rejects empty/whitespace-only feedback messages.
  - Normalizes invalid timestamps to server time.
  - Adds per-IP rate limiting (10 submissions per minute when KV is configured).
- Updated package metadata links in `package.json` to the canonical `BenSweaterVest/LOON` repository.

### TODO
- Consolidate duplicate page ID sanitization/validation logic across API endpoints into one shared helper.
- Standardize endpoint-level JSDoc style and trim overlong in-file commentary where it does not add operational value.

