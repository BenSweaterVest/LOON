#!/usr/bin/env node
/**
 * Environment Variable Validation Script
 * Checks that required environment variables are properly configured
 * 
 * Usage: node scripts/check-env.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Required for all deployments
const REQUIRED_VARS = ['GITHUB_REPO', 'GITHUB_TOKEN'];

// Optional but recommended for full functionality
const OPTIONAL_VARS = ['CORS_ORIGIN', 'CF_ACCOUNT_ID', 'CF_IMAGES_TOKEN'];

function checkFile(filePath, description) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return {
                exists: true,
                content,
                path: filePath
            };
        }
    } catch (err) {
        console.warn(`⚠️  Could not read ${description}: ${err.message}`);
    }
    return { exists: false };
}

function parseEnvFile(content) {
    const vars = {};
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (key && value) {
                vars[key] = value;
            }
        }
    });
    return vars;
}

console.log('\n📋 LOON Environment Variable Check\n');
console.log('=====================================\n');

// Check .env files
const envFiles = [
    { path: path.join(projectRoot, '.env'), desc: '.env (local)' },
    { path: path.join(projectRoot, '.env.local'), desc: '.env.local (local)' },
    { path: path.join(projectRoot, '.dev.vars'), desc: '.dev.vars (Wrangler)' }
];

let foundVars = {};
let foundFile = null;

for (const file of envFiles) {
    const result = checkFile(file.path, file.desc);
    if (result.exists) {
        const vars = parseEnvFile(result.content);
        foundVars = { ...foundVars, ...vars };
        foundFile = file.desc;
        console.log(`✓ Found ${file.desc}`);
    }
}

if (!foundFile) {
    console.log('⚠️  No local .env files found');
    console.log('   This is OK for production (use Cloudflare dashboard)');
    console.log('   For local dev, create .env or .env.local');
}

console.log('\n=====================================\n');

// Check required variables
let allGood = true;

console.log('Required Variables:\n');
REQUIRED_VARS.forEach(varName => {
    const hasVar = varName in process.env || varName in foundVars;
    const status = hasVar ? '✓' : '✗';
    console.log(`  ${status} ${varName}`);
    
    if (!hasVar) {
        allGood = false;
    }
});

console.log('\nOptional Variables:\n');
OPTIONAL_VARS.forEach(varName => {
    const hasVar = varName in process.env || varName in foundVars;
    const status = hasVar ? '✓' : '○';
    console.log(`  ${status} ${varName}`);
});

console.log('\n=====================================\n');

// Validation results
if (allGood) {
    console.log('✓ All required variables are set!\n');
    process.exit(0);
} else {
    console.log('✗ Missing required variables!\n');
    console.log('Setup instructions:');
    console.log('  1. Copy .env.example to .env.local');
    console.log('  2. Fill in GITHUB_REPO and GITHUB_TOKEN');
    console.log('  3. For Wrangler: use .dev.vars instead');
    console.log('  4. See .env.example for detailed instructions\n');
    process.exit(1);
}
