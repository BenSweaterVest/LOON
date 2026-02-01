#!/usr/bin/env node
/**
 * JSON Validation Script
 * Validates all JSON files in the project
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let errors = 0;
let validated = 0;

function validateJsonFile(filePath) {
    try {
        const content = readFileSync(filePath, 'utf8');
        JSON.parse(content);
        validated++;
        return true;
    } catch (e) {
        console.error(`${RED}ERROR${RESET} ${filePath}: ${e.message}`);
        errors++;
        return false;
    }
}

function walkDir(dir, skipDirs = ['node_modules', '.git', '.wrangler']) {
    const files = readdirSync(dir);
    
    for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        
        if (stat.isDirectory()) {
            if (!skipDirs.includes(file)) {
                walkDir(filePath, skipDirs);
            }
        } else if (extname(file) === '.json') {
            validateJsonFile(filePath);
        }
    }
}

console.log('Validating JSON files...\n');
walkDir('.');

console.log(`\n${GREEN}Validated:${RESET} ${validated} files`);
if (errors > 0) {
    console.log(`${RED}Errors:${RESET} ${errors} files`);
    process.exit(1);
} else {
    console.log(`${GREEN}All JSON files are valid!${RESET}`);
}
