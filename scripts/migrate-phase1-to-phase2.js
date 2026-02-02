#!/usr/bin/env node

/**
 * ============================================================================
 * Phase 1 to Phase 2 Migration Script
 * ============================================================================
 *
 * Converts Phase 1 environment variable users to Phase 2 KV users.
 *
 * WHAT IT DOES:
 *   1. Scans environment variables for USER_{PAGEID}_PASSWORD
 *   2. Creates KV user accounts with Contributor role
 *   3. Assigns each user to their page (assignedPage field)
 *   4. Outputs list of users and temporary passwords
 *
 * USAGE:
 *   node migrate-phase1-to-phase2.js
 *
 * PREREQUISITES:
 *   - CF_ACCOUNT_ID environment variable
 *   - CF_API_TOKEN environment variable
 *   - KV_NAMESPACE_ID environment variable
 *
 * @version 3.1.0
 */

const crypto = require('crypto');

// Configuration
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
    console.error('ERROR: Missing required environment variables');
    console.error('Required: CF_ACCOUNT_ID, CF_API_TOKEN, KV_NAMESPACE_ID');
    process.exit(1);
}

/**
 * Hash password using PBKDF2
 */
async function hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey.toString('hex'));
        });
    });
}

/**
 * Generate random password
 */
function generatePassword(length = 16) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    const bytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
        password += chars[bytes[i] % chars.length];
    }
    
    return password;
}

/**
 * Write to Cloudflare KV
 */
async function writeToKV(key, value) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${key}`;
    
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(value)
    });
    
    if (!res.ok) {
        const error = await res.text();
        throw new Error(`KV write failed: ${res.status} - ${error}`);
    }
    
    return true;
}

/**
 * Main migration function
 */
async function migrate() {
    console.log('='.repeat(70));
    console.log('Phase 1 → Phase 2 Migration');
    console.log('='.repeat(70));
    console.log();
    
    // Scan environment variables for Phase 1 users
    const phase1Users = [];
    
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('USER_') && key.endsWith('_PASSWORD')) {
            const pageId = key
                .replace('USER_', '')
                .replace('_PASSWORD', '')
                .toLowerCase();
            
            phase1Users.push({
                pageId,
                username: pageId,
                password: value
            });
        }
    }
    
    if (phase1Users.length === 0) {
        console.log('No Phase 1 users found in environment variables.');
        console.log('Looking for variables matching: USER_{PAGEID}_PASSWORD');
        console.log();
        return;
    }
    
    console.log(`Found ${phase1Users.length} Phase 1 user(s):`);
    phase1Users.forEach(u => console.log(`  - ${u.username} (page: ${u.pageId})`));
    console.log();
    
    const migratedUsers = [];
    
    for (const user of phase1Users) {
        try {
            // Generate new password (Phase 1 passwords are often simple)
            const newPassword = generatePassword(16);
            const salt = crypto.randomUUID();
            const hash = await hashPassword(newPassword, salt);
            
            // Create KV user
            const userData = {
                username: user.username,
                role: 'contributor',
                hash,
                salt,
                created: new Date().toISOString(),
                createdBy: 'migration-script',
                assignedPage: user.pageId,
                migrated: true,
                migratedFrom: 'phase1'
            };
            
            await writeToKV(`user:${user.username}`, userData);
            
            migratedUsers.push({
                username: user.username,
                password: newPassword,
                pageId: user.pageId,
                role: 'contributor'
            });
            
            console.log(`✓ Migrated: ${user.username}`);
            
        } catch (error) {
            console.error(`✗ Failed to migrate ${user.username}:`, error.message);
        }
    }
    
    console.log();
    console.log('='.repeat(70));
    console.log('Migration Complete');
    console.log('='.repeat(70));
    console.log();
    console.log(`Successfully migrated: ${migratedUsers.length}/${phase1Users.length} users`);
    console.log();
    
    if (migratedUsers.length > 0) {
        console.log('NEW CREDENTIALS (share securely with users):');
        console.log('-'.repeat(70));
        
        migratedUsers.forEach(user => {
            console.log();
            console.log(`Username: ${user.username}`);
            console.log(`Password: ${user.password}`);
            console.log(`Role:     ${user.role}`);
            console.log(`Page:     ${user.pageId}`);
        });
        
        console.log();
        console.log('-'.repeat(70));
        console.log();
        console.log('NEXT STEPS:');
        console.log('1. Share credentials with each user securely');
        console.log('2. Users can login at /admin.html with new credentials');
        console.log('3. Users can change their password in "My Account" tab');
        console.log('4. Remove Phase 1 environment variables (USER_*_PASSWORD)');
        console.log('5. Deploy updated code without Phase 1 auth support');
        console.log();
    }
}

// Run migration
migrate().catch(err => {
    console.error('MIGRATION FAILED:', err);
    process.exit(1);
});
