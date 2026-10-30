import { Router } from '../router.js';
import { register as health } from './health.js';
import { register as setup } from './setup.js';
import { register as auth } from './auth.js';
import { register as passkeys } from './passkeys.js';
import { register as users } from './users.js';
import { register as sessions } from './sessions.js';
import { register as audit } from './audit.js';

export function buildRouter() {
    const router = new Router();
    for (const register of [health, setup, auth, passkeys, users, sessions, audit]) register(router);
    return router;
}
