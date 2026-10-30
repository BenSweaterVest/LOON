import { Router } from '../router.js';
import { register as health } from './health.js';
import { register as setup } from './setup.js';
import { register as auth } from './auth.js';
import { register as passkeys } from './passkeys.js';
import { register as users } from './users.js';
import { register as sessions } from './sessions.js';
import { register as audit } from './audit.js';
import { register as pages } from './pages.js';
import { register as publishing } from './publishing.js';
import { register as media } from './media.js';
import { register as collab } from './collab.js';
import { register as admin } from './admin.js';

export function buildRouter() {
    const router = new Router();
    for (const register of [health, setup, auth, passkeys, users, sessions, audit, pages, publishing, media, collab, admin]) {
        register(router);
    }
    return router;
}
