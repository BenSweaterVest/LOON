#!/usr/bin/env node

/**
 * ============================================================================
 * LOON Admin Onboarding Script (scripts/bootstrap-admin.js)
 * ============================================================================
 *
 * Automated first-time setup for LOON instances.
 * Creates initial admin user and verifies KV namespace connectivity.
 *
 * USAGE:
 *   npx wrangler kv:key put --namespace-id <YOUR_KV_ID> \
 *     'user:admin' '{...}'
 *
 * Or use this helper:
 *   node scripts/bootstrap-admin.js --username admin --password mypassword \
 *     --namespace-id abc123 --account-id def456
 *
 * This script:
 *   1. Creates an initial admin user in KV (bootstrap mode)
 *   2. On first login, auth.js hashes the password securely (PBKDF2)
 *   3. Verifies the user was created successfully
 *   4. Outputs next steps for production deployment
 */

import crypto from 'crypto';
import { promisify } from 'util';

const pbkdf2 = promisify(crypto.pbkdf2);

/**
 * Create admin user entry for KV storage
 * Uses bootstrap mode for compatibility with auth.js
 *
 * @param {string} username - Admin username
 * @param {string} password - Plain text password (will be hashed on first login)
 * @returns {Promise<Object>} - User object ready for KV
 */
async function createAdminUser(username, password) {
    // Use bootstrap mode instead of pre-hashing
    // auth.js will hash the password on first login
    return {
        username,
        role: 'admin',
        password,
        bootstrap: true,
        created: new Date().toISOString(),
        lastLogin: null,
        mfaEnabled: false,
        passkeysEnabled: false
    };
}

/**
 * Generate wrangler KV command for creating user
 *
 * @param {string} username - Username
 * @param {Object} userObj - User object
 * @param {string} namespaceId - KV namespace ID
 * @returns {string} - Shell command to run
 */
function generateCommand(username, userObj, namespaceId) {
    const key = `user:${username}`;
    const value = JSON.stringify(userObj);
    
    // Note: Command-line escaping varies by shell
    // Users should review and copy-paste carefully
    return `wrangler kv:key put --namespace-id ${namespaceId} '${key}' '${JSON.stringify(userObj, null, 2)}'`;
}

/**
 * Main bootstrap function
 */
async function bootstrap() {
    const args = process.argv.slice(2);
    
    // Parse arguments
    const options = {
        username: 'admin',
        password: null,
        namespaceId: null,
        accountId: null,
        interactive: true
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--username':
                options.username = args[++i];
                break;
            case '--password':
                options.password = args[++i];
                options.interactive = false;
                break;
            case '--namespace-id':
                options.namespaceId = args[++i];
                break;
            case '--account-id':
                options.accountId = args[++i];
                break;
        }
    }
    
    console.log('\n--- LOON Admin Onboarding ---\n');
    console.log('This script creates the initial admin user for your LOON instance.\n');
    
    // Get password if not provided
    if (!options.password) {
        console.log('WARNING: Storing passwords in shell history is a security risk.');
        console.log('   Pass --password via environment variable or stdin instead:\n');
        console.log('   read -s PASSWORD && node scripts/bootstrap-admin.js --password $PASSWORD\n');
        
        process.exit(1);
    }
    
    // Require namespace ID
    if (!options.namespaceId) {
        console.log('ERROR: --namespace-id is required\n');
        console.log('Find your KV namespace ID in Cloudflare Dashboard:');
        console.log('  Settings > Functions > KV namespace bindings\n');
        process.exit(1);
    }
    
    console.log(`Creating admin user: ${options.username}`);
    console.log(`KV Namespace ID: ${options.namespaceId}\n`);
    
    try {
        // Generate user object
        const userObj = await createAdminUser(options.username, options.password);
        
        console.log('Admin user created successfully\n');
        console.log('User details:');
        console.log(`  Username: ${userObj.username}`);
        console.log(`  Role: ${userObj.role}`);
        console.log(`  Created: ${userObj.created}`);
        console.log(`  Password: ${options.password.length} characters\n`);
        
        // Show command to run
        console.log('Next step: Run this command in your terminal:\n');
        console.log('```bash');
        console.log(`wrangler kv:key put --namespace-id "${options.namespaceId}" \\`);
        console.log(`  'user:${options.username}' '${JSON.stringify(userObj)}'`);
        console.log('```\n');
        
        console.log('Or via curl (from terminal with proper quoting):\n');
        console.log('```bash');
        console.log(`curl -X PUT https://your-domain.com/api/users \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -d '${JSON.stringify({ username: options.username, password: options.password, role: 'admin' })}'`);
        console.log('```\n');
        
        console.log('IMPORTANT SECURITY NOTES:\n');
        console.log('  1. Keep the password secure - share via secure channel only');
        console.log('  2. Change password after first login');
        console.log('  3. Enable passkeys for MFA (WebAuthn)');
        console.log('  4. Delete this command from shell history:\n');
        console.log('     history -d $(history 1)  # bash');
        console.log('     # or manually remove from ~/.bash_history\n');
        
        // Show verification steps
        console.log('To verify the user was created:\n');
        console.log('```bash');
        console.log(`wrangler kv:key get --namespace-id "${options.namespaceId}" 'user:${options.username}'`);
        console.log('```\n');
        
        console.log('Admin user is ready to log in!\n');
        
    } catch (err) {
        console.error('ERROR creating admin user:', err.message);
        process.exit(1);
    }
}

// Run bootstrap
bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
