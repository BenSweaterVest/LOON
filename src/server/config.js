/**
 * Typed view over the environment. Every env var LOON reads is listed here.
 */

const MAX_PBKDF2_ITERATIONS = 100000; // Cloudflare Workers rejects higher counts.

function intInRange(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

export function getConfig(env = {}) {
    const githubRepo = (env.GITHUB_REPO || '').trim();
    return {
        environment: env.LOON_ENV === 'development' ? 'development' : 'production',
        githubRepo,
        githubToken: env.GITHUB_TOKEN || '',
        githubBranch: (env.GITHUB_BRANCH || 'main').trim(),
        githubConfigured: /^[\w.-]+\/[\w.-]+$/.test(githubRepo) && !!env.GITHUB_TOKEN,
        setupToken: env.SETUP_TOKEN || '',
        cronSecret: env.CRON_SECRET || '',
        rpId: env.RP_ID || '',
        rpName: env.RP_NAME || 'LOON',
        rpOrigin: env.RP_ORIGIN || '',
        siteUrl: (env.SITE_URL || '').replace(/\/+$/, ''),
        sessionTtlSeconds: intInRange(env.SESSION_TTL_HOURS, 24, 1, 24 * 30) * 3600,
        pbkdf2Iterations: intInRange(env.PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS, 1000, MAX_PBKDF2_ITERATIONS),
        auditRetentionDays: intInRange(env.AUDIT_RETENTION_DAYS, 90, 1, 3650)
    };
}

export function isDevelopment(env) {
    return getConfig(env).environment === 'development';
}
