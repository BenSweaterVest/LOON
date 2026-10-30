/**
 * D1 schema and migrations. The app applies pending migrations itself on the
 * first request an isolate serves, so setup needs no CLI step.
 *
 * Timestamps are integer milliseconds since the epoch.
 * Append new migrations; never edit one that has shipped.
 */

export const MIGRATIONS = [
    {
        version: 1,
        statements: [
            `CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                display_name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'contributor')),
                password_hash TEXT NOT NULL,
                disabled INTEGER NOT NULL DEFAULT 0,
                must_change_password INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                created_by TEXT,
                updated_at INTEGER NOT NULL,
                last_login_at INTEGER,
                password_changed_at INTEGER
            )`,
            `CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                method TEXT NOT NULL DEFAULT 'password',
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                ip TEXT,
                user_agent TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS sessions_username ON sessions(username)`,
            `CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at)`,
            `CREATE TABLE IF NOT EXISTS passkeys (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                public_key TEXT NOT NULL,
                counter INTEGER NOT NULL DEFAULT 0,
                transports TEXT NOT NULL DEFAULT '[]',
                device_type TEXT,
                backed_up INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL DEFAULT 'Passkey',
                created_at INTEGER NOT NULL,
                last_used_at INTEGER
            )`,
            `CREATE INDEX IF NOT EXISTS passkeys_username ON passkeys(username)`,
            `CREATE TABLE IF NOT EXISTS recovery_codes (
                username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                used_at INTEGER,
                PRIMARY KEY (username, code_hash)
            )`,
            `CREATE TABLE IF NOT EXISTS challenges (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                username TEXT,
                challenge TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                template TEXT,
                schema TEXT NOT NULL,
                draft TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                workflow TEXT NOT NULL DEFAULT 'draft' CHECK (workflow IN ('draft', 'review')),
                scheduled_for INTEGER,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                published TEXT,
                published_version INTEGER,
                published_at INTEGER,
                published_by TEXT,
                published_commit TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS pages_scheduled ON pages(scheduled_for) WHERE scheduled_for IS NOT NULL`,
            `CREATE TABLE IF NOT EXISTS revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                schema TEXT NOT NULL,
                data TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                note TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS revisions_page ON revisions(page_id, id)`,
            `CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                mime TEXT NOT NULL,
                size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                alt TEXT NOT NULL DEFAULT '',
                data BLOB,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                published_at INTEGER
            )`,
            `CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS watches (
                username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                page_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (username, page_id)
            )`,
            `CREATE INDEX IF NOT EXISTS watches_page ON watches(page_id)`,
            `CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at INTEGER NOT NULL,
                actor TEXT,
                action TEXT NOT NULL,
                target TEXT,
                details TEXT,
                ip TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS audit_at ON audit(at)`,
            `CREATE INDEX IF NOT EXISTS audit_target ON audit(target, at)`,
            `CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                window_start INTEGER NOT NULL,
                count INTEGER NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id TEXT NOT NULL,
                message TEXT NOT NULL,
                contact TEXT,
                created_at INTEGER NOT NULL,
                resolved_at INTEGER,
                resolved_by TEXT
            )`,
            `CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at)`,
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_by TEXT,
                updated_at INTEGER NOT NULL
            )`
        ]
    }
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
