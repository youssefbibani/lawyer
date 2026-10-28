# Making the project deployable on Vercel: the code changes

**These changes are already applied to the repository** (the commit "Prepare for Vercel"). This page is kept as
the reference for what they are and why: Vercel runs the API as a *serverless function*, and this project's API
was a normal Node server, so the changes below adapt it. To deploy, follow [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

They are small: 5 new files, and short edits to 6 existing ones. The web app itself is not touched. (The
commit also adds a test file, `server/tests/vercel-and-cron.test.ts`, and one line in
`server/tests/setup-env.ts`; neither is needed at run time.)

## What has and has not been checked

Checked, on a Windows machine, with exactly the files below:

- The real function entry (`api/index.js`) was loaded in a plain Node HTTP server with Vercel-style environment
  variables, against a development database: health check, JSON 404, the cron endpoint (404 without the secret,
  report with it), CSRF refusal of an unknown origin, sign-in from the derived production address, `Secure` +
  `httpOnly` session cookie, an authenticated API call, and per-visitor rate limiting behind the proxy.
- Vercel's own builder (`vercel build`, run offline on a clean copy with a fresh `npm ci`) completed, detected the
  function (`api/index.js`, Node 22), generated the right routing, and packaged it at about 17 MB (limit 250 MB).
- 12 new tests, plus the existing suites (143 web tests, 93 server tests), passed.

**What those checks missed:** they ran the function in a plain Node server, so they did not reproduce Vercel's
own request handling. The first real deployment showed it: POST bodies were lost (see the note under
`server/vercel-handler.ts`). The function now has a test that sends a real sign-in POST through the exact handler
Vercel calls.

**Confirmed on a real deployment (Vercel + Neon):** the build and migrations, the Linux Prisma engine, and
`/api/health` answering `{"status":"ok","database":"ok"}`.

**Not checked yet:** sign-in on the real deployment after the `fetch` handler fix, and Vercel's cron.
[DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) has a troubleshooting table.

---

## Part 1. New files

Create each file with exactly this content.

### `vercel.json`

Tells Vercel how to build, where the API lives, and which headers to add.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build:vercel",
  "outputDirectory": "dist",
  "functions": {
    "api/index.js": {
      "maxDuration": 30,
      "includeFiles": "node_modules/.prisma/client/**"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/((?!api/).*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

### `api/index.js`

The serverless function entry. It re-exports the server that the build compiles.

```js
// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The server is compiled to dist-server/ during the build (`npm run build:vercel`), then imported from here.
export { default } from "../dist-server/server/vercel-handler.js";
```

### `server/vercel-handler.ts`

Exposes the existing Hono app to Vercel as a Web-standard `fetch` handler.

```ts
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
```

> **Why not the Node adapter?** The first version of this file used `handle()` from `@hono/node-server/vercel`.
> It passed every local check, but on a real Vercel deployment each sign-in request timed out after 30 seconds
> (`Vercel Runtime Timeout Error` in the logs). The test that guards this is "Vercel entry point" in
> `server/tests/vercel-and-cron.test.ts`.

### `server/routes/cron.ts`

An endpoint a scheduler can call to deliver reminders (serverless has no background worker).

```ts
import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";

import { env } from "../env.js";
import type { AppEnv } from "../http/context.js";
import { AppError, errorBody } from "../http/errors.js";
import { deliverDueReminders } from "../services/reminders.js";

function authorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled jobs for hosts that cannot keep a background worker alive (serverless). An external scheduler
 * calls them with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this header on its own).
 * Without CRON_SECRET, or with the wrong one, the endpoint answers 404 so it does not advertise itself.
 */
export function cronRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/reminders", async (c) => {
    if (!authorized(c.req.header("authorization"), env().CRON_SECRET)) {
      return c.json(errorBody(new AppError("NOT_FOUND", "المسار غير موجود."), c.get("requestId")), 404);
    }
    const report = await deliverDueReminders();
    if (report.processed) console.info(`[reminders] processed=${report.processed} sent=${report.sent} failed=${report.failed} not_configured=${report.notConfigured} cancelled=${report.cancelled}`);
    return c.json(report);
  });

  return routes;
}
```

### `scripts/vercel-migrate.mjs`

Applies database migrations during Production builds only.

```js
#!/usr/bin/env node
/**
 * Runs during a Vercel build (see "build:vercel"): applies pending database migrations before the new
 * version goes live, so the code and the schema never disagree.
 *
 * Only Production deployments migrate. A Preview deployment must never change the live database, even if
 * it shares its connection string. Set SKIP_MIGRATIONS=true to migrate by hand instead.
 *
 * Migrations need a direct (non-pooled) connection: pooled connections (PgBouncer) break Prisma's migration
 * locks. Neon's Vercel integration provides it as DATABASE_URL_UNPOOLED; otherwise set DIRECT_URL.
 */
import { spawnSync } from "node:child_process";

const env = process.env;

if (env.VERCEL_ENV !== "production") {
  console.log(`[migrate] skipped: this is not a Production deployment (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}).`);
  process.exit(0);
}
if (env.SKIP_MIGRATIONS === "true") {
  console.log("[migrate] skipped: SKIP_MIGRATIONS=true.");
  process.exit(0);
}

const url = env.DATABASE_URL_UNPOOLED || env.DIRECT_URL || env.DATABASE_URL;
if (!url) {
  console.error("[migrate] No database connection string. Add DATABASE_URL (and DATABASE_URL_UNPOOLED) to the Production environment variables.");
  process.exit(1);
}
if (!env.DATABASE_URL_UNPOOLED && !env.DIRECT_URL && /-pooler\./.test(url)) {
  console.warn("[migrate] Warning: only a pooled connection string is available. If migrations fail on a lock, add DATABASE_URL_UNPOOLED.");
}

console.log("[migrate] applying pending migrations (prisma migrate deploy)...");
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", shell: true, env: { ...env, DATABASE_URL: url } });
process.exit(result.status ?? 1);
```

---

## Part 2. Changes to existing files

Each block is a diff: lines starting with `+` are added, lines starting with `-` are removed.

### `server/app.ts`

Mount the cron routes (2 small changes).

```diff
@@ -9,4 +9,5 @@ import { AppError, errorBody, fromDatabase } from "./http/errors.js";
 import { clientIp, ctxOf, originCheck, requestId } from "./http/middleware.js";
 import { authRoutes } from "./routes/auth.js";
+import { cronRoutes } from "./routes/cron.js";
 import { v1Routes } from "./routes/v1.js";
 import { audit } from "./services/audit.js";
@@ -50,4 +51,6 @@ export function createApp() {
   app.use("/api/v1/*", originCheck);
   app.route("/api/v1", v1Routes());
+  // Scheduled jobs (secret header, no cookies): see routes/cron.ts.
+  app.route("/api/cron", cronRoutes());
   app.all("/api/*", (c) => c.json(errorBody(new AppError("NOT_FOUND", "المسار غير موجود."), c.get("requestId")), 404));
 
```

### `server/env.ts`

On Vercel: derive the public address, trust the proxy header, trust the deployment address; add the optional `CRON_SECRET`.

```diff
@@ -38,10 +38,36 @@ const schema = z.object({
     .optional()
     .transform((v) => v !== "false"),
+  /**
+   * Shared secret for the scheduled-job endpoints (GET /api/cron/*) used where no background worker can run
+   * (serverless). Callers send `Authorization: Bearer <secret>`; Vercel Cron does this by itself. Unset = disabled.
+   */
+  CRON_SECRET: z
+    .string()
+    .optional()
+    .transform((v) => v?.trim() || undefined)
+    .refine((v) => !v || v.length >= 16, "CRON_SECRET must be at least 16 characters"),
 });
 
 export type Env = z.infer<typeof schema>;
 
+/**
+ * On Vercel the public address and the proxy setup are known, so a first deployment needs fewer variables:
+ * the app's own address becomes BETTER_AUTH_URL (the production domain for Production, the deployment address
+ * otherwise), the deployment address is a trusted origin (it is this same app), and the client address is
+ * read from X-Forwarded-For, which Vercel sets itself. Anything set explicitly still wins.
+ */
+function withVercelDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
+  if (!source.VERCEL) return source;
+  const host = source.VERCEL_ENV === "production" ? source.VERCEL_PROJECT_PRODUCTION_URL || source.VERCEL_URL : source.VERCEL_URL;
+  return {
+    ...source,
+    BETTER_AUTH_URL: source.BETTER_AUTH_URL?.trim() || (host ? `https://${host}` : undefined),
+    TRUSTED_ORIGINS: [source.TRUSTED_ORIGINS, source.VERCEL_URL && `https://${source.VERCEL_URL}`].filter(Boolean).join(","),
+    TRUST_PROXY: source.TRUST_PROXY || "true",
+  };
+}
+
 export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
-  const parsed = schema.safeParse(source);
+  const parsed = schema.safeParse(withVercelDefaults(source));
   if (!parsed.success) {
     const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
```

### `package.json`

A `build:vercel` script and the Node version.

```diff
@@ -4,4 +4,7 @@
   "version": "1.0.0",
   "type": "module",
+  "engines": {
+    "node": "22.x"
+  },
   "scripts": {
     "dev": "vite",
@@ -9,4 +12,5 @@
     "build": "tsc -b && vite build",
     "build:server": "prisma generate && tsc -p tsconfig.server.json",
+    "build:vercel": "prisma generate && npm run build && tsc -p tsconfig.server.json && node scripts/vercel-migrate.mjs",
     "start": "node dist-server/server/index.js",
     "lint": "oxlint",
```

### `prisma/schema.prisma`

Generate the Linux engine that Vercel's runtime needs.

```diff
@@ -8,5 +8,8 @@
 
 generator client {
-  provider = "prisma-client-js"
+  provider      = "prisma-client-js"
+  // "native" = the machine running `prisma generate` (development, Docker). The extra target is the
+  // engine Vercel's runtime (Amazon Linux) needs, generated explicitly instead of relying on auto-detection.
+  binaryTargets = ["native", "rhel-openssl-3.0.x"]
 }
 
```

### `.gitignore`

Ignore the Vercel CLI folder.

```diff
@@ -33,2 +33,5 @@ test-results
 storage
 e2e/.state
+
+# Vercel CLI link/state
+.vercel
```

### `.env.example`

Document `CRON_SECRET`.

```diff
@@ -56,2 +56,6 @@ TRUST_PROXY=false
 # Set to false to disable the reminder delivery worker in this process.
 REMINDER_WORKER=true
+
+# Secret for the scheduled-job endpoint GET /api/cron/reminders (hosts without a background worker, e.g. Vercel).
+# At least 16 characters; callers send `Authorization: Bearer <secret>`. Empty = endpoint disabled.
+CRON_SECRET=
```

---

## Part 3. Check, then commit (already done)

```bash
npx tsc -p tsconfig.server.json --noEmit     # the server still compiles
npm run build:server                          # prisma generate + compile (stop `npm run dev:server` first on Windows)
git add -A && git commit -m "Prepare for Vercel" && git push
```

Notes:

- `prisma generate` after the schema change downloads one extra engine (the Linux one). That is expected.
- Regenerating the Prisma client on Windows fails with `EPERM` while the dev server is running: stop it first.
- The two existing front-end and server test suites are unaffected by these changes.
