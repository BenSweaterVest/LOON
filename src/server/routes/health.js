/**
 * GET /api/health: public liveness check. Reveals nothing about configuration
 * beyond whether the instance is ready; admins get details from /api/diagnostics.
 */

export function register(router) {
    router.get('/api/health', async (ctx) => {
        await ctx.db.prepare('SELECT 1').first();
        return { ok: true, time: new Date().toISOString() };
    });
}
