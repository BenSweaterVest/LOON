// Single entry point for /api/*. Routing lives in src/server/routes.
import { handle } from '../../src/server/app.js';

export const onRequest = (context) => handle(context.request, context.env, context);
