/**
 * Vercel entry point (re-exported by api/index.js; every /api/* request is rewritten there by vercel.json).
 * On Vercel the API runs as a serverless function: Vercel serves the built SPA itself, and there is no
 * background worker, so scheduled jobs reach the app through /api/cron/* instead.
 */
import { handle } from "@hono/node-server/vercel";

import { createApp } from "./app.js";

export default handle(createApp());
