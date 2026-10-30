import { Router } from '../router.js';
import { register as health } from './health.js';

export function buildRouter() {
    const router = new Router();
    for (const register of [health]) register(router);
    return router;
}
