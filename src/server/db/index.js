/**
 * D1 access: binding lookup, migrations, and small query helpers.
 */

import { HttpError } from '../http.js';
import { MIGRATIONS, LATEST_VERSION } from './schema.js';

const migrated = new WeakSet();

export function getDb(env) {
    const db = env?.DB;
    if (!db) {
        throw new HttpError(500, 'Database not configured. Bind a D1 database to this Pages project with the variable name DB.');
    }
    return db;
}

async function currentVersion(db) {
    await db.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    return row ? Number(row.value) : 0;
}

/**
 * Apply pending migrations. Cheap after the first call per isolate.
 */
export async function migrate(db) {
    if (migrated.has(db)) return;
    let version = await currentVersion(db);
    for (const migration of MIGRATIONS) {
        if (migration.version <= version) continue;
        const statements = migration.statements.map((sql) => db.prepare(sql));
        statements.push(
            db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
                .bind(String(migration.version))
        );
        await db.batch(statements);
        version = migration.version;
    }
    if (version >= LATEST_VERSION) migrated.add(db);
}

export async function first(db, sql, ...params) {
    return db.prepare(sql).bind(...params).first();
}

export async function all(db, sql, ...params) {
    const { results } = await db.prepare(sql).bind(...params).all();
    return results;
}

export async function run(db, sql, ...params) {
    return db.prepare(sql).bind(...params).run();
}

export function parseJson(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}
