/**
 * User records: lookups and invariants shared by setup, auth and admin routes.
 */

import { all, first } from './db/index.js';
import { conflict, notFound } from './http.js';

const PUBLIC_COLUMNS = `username, display_name, role, disabled, must_change_password,
    created_at, created_by, updated_at, last_login_at, password_changed_at`;

export function publicUser(row) {
    return {
        username: row.username,
        displayName: row.display_name || '',
        role: row.role,
        disabled: !!row.disabled,
        mustChangePassword: !!row.must_change_password,
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at,
        passwordChangedAt: row.password_changed_at
    };
}

export async function getUser(db, username) {
    return first(db, `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?`, username);
}

export async function requireUser(db, username) {
    const user = await getUser(db, username);
    if (!user) throw notFound('User not found');
    return user;
}

export async function listUsers(db) {
    const rows = await all(db, `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY username`);
    return rows.map(publicUser);
}

export async function countActiveAdmins(db) {
    const row = await first(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0");
    return row.n;
}

export async function userCount(db) {
    const row = await first(db, 'SELECT COUNT(*) AS n FROM users');
    return row.n;
}

/**
 * Throw if a change would leave the instance without an active admin.
 */
export async function assertKeepsAnAdmin(db, target, { role = target.role, disabled = !!target.disabled, deleting = false } = {}) {
    const wasActiveAdmin = target.role === 'admin' && !target.disabled;
    const staysActiveAdmin = !deleting && role === 'admin' && !disabled;
    if (wasActiveAdmin && !staysActiveAdmin && (await countActiveAdmins(db)) <= 1) {
        throw conflict('At least one active admin is required');
    }
}

/**
 * Readable temporary password, e.g. "kq7m-2xwp-h4dz-9tnc".
 */
export function temporaryPassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return chars.match(/.{4}/g).join('-');
}
