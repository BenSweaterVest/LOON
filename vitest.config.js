import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Test environment
        environment: 'node',
        
        // Test file patterns
        include: ['tests/**/*.test.js'],
        
        // Coverage settings
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            include: ['functions/**/*.js'],
            exclude: ['node_modules', 'tests'],
            thresholds: {
                statements: 35,
                branches: 55,
                functions: 50,
                lines: 35
            }
        },
        
        // Timeout for async tests
        testTimeout: 10000,
        
        // Run tests in sequence (for shared state)
        sequence: {
            shuffle: false
        }
    }
});
