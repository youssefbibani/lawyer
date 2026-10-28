/**
 * Vercel entry point (re-exported by api/index.js; every /api/* request is rewritten there by vercel.json).
 * On Vercel the API runs as a serverless function: Vercel serves the built SPA itself, and there is no
 * background worker, so scheduled jobs reach the app through /api/cron/* instead.
 *
 * This is a Web-standard `fetch` handler: Vercel builds the Request (body included) and calls fetch(request).
 * Do not wrap the app with `@hono/node-server/vercel` instead. Vercel's Node runtime reads the request body
 * *before* calling a Node-style (req, res) handler and only replays it through req.on("data"/"end"), which the
 * adapter's stream bridge does not use: every POST then arrives with an empty body and sign-in answers
 * "Invalid JSON in request body" (or hangs until the function times out).
 */
import { createApp } from "./app.js";

export default { fetch: createApp().fetch };
