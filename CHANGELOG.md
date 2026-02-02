# Changelog

All notable changes to Project LOON will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-02-02

### Added
- Draft/publish workflow with `POST /api/publish`
- Image uploads via Cloudflare Images (`POST /api/upload`)
- JSON Schema conversion and validation utilities
- Phase 1 → Phase 2 migration script
- Admin UI support for drafts, publishing, and image uploads

### Changed
- Public site now displays published content only
- Health check now reports optional images configuration
- Updated environment variable template for Images

### Fixed
- Save endpoint draft workflow metadata handling
- Contributor saves enforced as draft

---

## [3.0.0] - 2026-02-01

### Breaking Changes
- **Removed Phase 1 (Directory Mode)**: Environment variable-based authentication has been removed
- **KV Required**: Cloudflare KV namespace `LOON_DB` is now mandatory
- **API Path Changes**: Removed `-v2` suffix from endpoints:
  - `/api/auth-v2` → `/api/auth`
  - `/api/save-v2` → `/api/save`
- **Removed Files**:
  - `admin-v2.html` renamed to `admin.html`
  - `scripts/manage-users.sh` (Phase 1 user management)

### Added
- **In-App Page Creation**: Admin/Editor can create pages from the web UI
  - `POST /api/pages` - Create new page with template or custom schema
  - `GET /api/templates` - List available schema templates
- **Audit Logging**: Track all key actions
  - `_audit.js` utility for consistent logging
  - `GET /api/audit` - View audit logs (admin only)
  - Tracked actions: login, logout, password_change, content_save, content_delete, page_create, user_create, user_delete, user_update, password_reset
  - 30-day retention with automatic expiration
- **Template System**: Use schemas from `examples/` folder when creating pages

### Changed
- **Consolidated Architecture**: Single KV-only mode (no more Phase 1/Phase 2 distinction)
- **Health Endpoint**: KV database check is now mandatory for healthy status
- **Version**: Updated to 3.0.0 across all files
- **Documentation**: README rewritten to reflect unified architecture

### Removed
- Phase 1 authentication (environment variable passwords)
- `manage-users.sh` script
- Mode detection in health check

### Migration Guide

If upgrading from v2.x:

1. **Required**: Set up Cloudflare KV namespace `LOON_DB` if not already configured
2. **Required**: Create admin user via `./scripts/bootstrap-admin.sh`
3. **Update**: Change API calls from `/api/auth-v2` to `/api/auth`
4. **Update**: Change API calls from `/api/save-v2` to `/api/save`
5. **Remove**: Delete `USER_*_PASSWORD` environment variables (no longer used)

---

## [2.0.0] - 2026-01-30

### Added - Testing & CI/CD
- **GitHub Actions CI pipeline**: Automated validation on every push/PR
  - JSON file validation
  - JavaScript syntax checking
  - Security scanning for hardcoded secrets
  - Cloudflare Functions structure validation
  - Automated test execution
- **GitHub Actions security workflow**: Weekly security scans
- **GitHub Actions release workflow**: Automated releases from version tags
- **GitHub Actions deploy-check**: Deployment readiness verification
- **Vitest test framework**: Unit tests for API logic
  - `tests/auth.test.js`: Phase 1 auth tests
  - `tests/auth-v2.test.js`: Phase 2 auth and RBAC tests
  - `tests/save.test.js`: Save endpoint tests
  - `tests/health.test.js`: Health check tests
  - `tests/schemas.test.js`: Schema validation tests
- **GitHub templates**:
  - Bug report template
  - Feature request template
  - Pull request template
  - CODEOWNERS file
- **package.json**: NPM scripts for development and testing
  - `npm test`: Run tests
  - `npm run lint`: Validate JS and JSON
  - `npm run dev`: Local development server

### Added - Phase 2: Team Mode
- **Cloudflare KV integration**: User database for unlimited users
- **Session tokens**: Secure authentication replacing password-per-request
- **Role-based access control (RBAC)**:
  - Admin: Full access, can manage users
  - Editor: Can edit any content
  - Contributor: Can only edit own content
- **User management API** (`/api/users`): Create, list, delete, update users
- **Bootstrap script** (`scripts/bootstrap-admin.sh`): Create first admin user
- **PBKDF2 password hashing**: Secure password storage with auto-upgrade
- **Phase 2 API endpoints**:
  - `GET /api/auth-v2`: Session verification
  - `POST /api/auth-v2`: Session-based login
  - `PATCH /api/auth-v2`: Self password change
  - `DELETE /api/auth-v2`: Logout
  - `POST /api/save-v2`: Save with RBAC enforcement
  - `/api/users`: Admin user management
  - `GET /api/pages`: List available pages (with RBAC filtering)
  - `GET /api/sessions`: List active sessions (admin)
  - `DELETE /api/sessions`: Revoke sessions (admin)
  - `DELETE /api/content`: Delete page content (admin/editor)
- **Self-service password change**: Users can change their own password
- **Page browser**: UI to browse and select available pages
- **Session management**: Admins can view and revoke active sessions
- **Content deletion**: Admins/Editors can delete page content
- **Bulk user creation**: Script to create users from CSV file

### Added - Documentation
- `docs/PHASE2-SETUP.md`: Complete Team Mode setup guide
- `docs/ONBOARDING.md`: User onboarding checklist
- `docs/CUSTOMIZATION.md`: Theming, custom domains, i18n
- `scripts/backup-content.sh`: Export content for backup
- `scripts/restore-content.sh`: Restore from backup

### Added - Admin Interface
- `admin-v2.html`: Team Mode admin UI with user management
- Session expiry detection and auto-logout
- Role badges for Admin/Editor/Contributor
- User creation with auto-generated passwords
- Password reset and user deletion (admin)
- **My Account tab**: Self-service password change for all users

### Changed
- `health.js`: Now returns operating mode (directory/team) and KV status
- Updated to v2.0.0 across all files

### Security
- Session tokens expire after 24 hours
- Automatic password hash upgrade for bootstrap users
- Rate limiting on all Phase 2 endpoints

---

## [1.2.0] - 2026-01-30

### Added
- **Dark mode**: Automatically follows system preference
- **Auto-save**: Drafts saved to localStorage every 30 seconds
- **Session persistence**: "Remember me" option for 7-day login
- **Password visibility toggle**: Show/hide password on login form
- **Character counter**: For fields with `maxlength` attribute
- **Image preview**: URL fields show thumbnail for image/photo/logo URLs
- **Last saved indicator**: Shows relative time since last save
- **Keyboard shortcuts help**: Press `?` to view shortcuts modal
- **Field validation**: Support for `maxlength`, `pattern`, `min`, `max` attributes
- New example schemas:
  - Menu/Pricing (restaurants, services)
  - Announcement (alerts, notices)
  - FAQ (help center)
  - Portfolio (project showcase)
  - Product/Service (offerings, SaaS features)
  - Testimonial (customer reviews)
  - Class/Workshop (education, fitness)
  - Service Status (uptime pages)
  - Property Listing (real estate, rentals)

### Changed
- Improved mobile responsiveness
- Better logout confirmation with unsaved changes warning
- Draft recovery prompt on login

---

## [1.1.0] - 2026-01-30

### Added
- New field types: `date`, `time`, `datetime`, `tel`, `checkbox`, `hidden`
- Required field support with visual indicator
- Example schemas for common use cases:
  - Event/meetup information
  - Business hours and status
  - Team member profiles
  - Job postings
  - Contact page information
- Field-level `description` option for help text
- Textarea `rows` option for custom height

### Changed
- Form builder refactored to handle new field types
- Number fields now stored as numeric values (not strings)
- Checkbox fields stored as boolean values

---

## [1.0.0] - 2026-01-30

### Added
- Initial Phase 1 release (Directory Mode)
- Universal editor (`admin.html`) with dynamic form generation
- Schema-driven content editing
- Cloudflare Functions for authentication and GitHub commits
- Timing-safe password comparison
- Rate limiting (30 requests/minute per IP)
- Content size limits (1MB max)
- Public page (`index.html`) with JSON rendering
- Mobile-responsive UI using Pico CSS
- Health check endpoint (`/api/health`)
- Example schemas: demo, food-truck, blog-post

### Security
- Passwords stored as Cloudflare encrypted environment variables
- Input sanitization for page IDs
- CORS headers on all API responses
- No secrets exposed to client-side code

---

## Roadmap

### [2.1.0] - Planned
- Audit logging for content changes
- Password complexity requirements (configurable)
- Content versioning (view/restore previous versions)
- Email notifications for admin events

### [3.0.0] - Future
- Two-factor authentication (2FA) for admin accounts
- Content approval workflows
- Scheduled publishing
- Multi-site management from single dashboard
- Webhook integrations
