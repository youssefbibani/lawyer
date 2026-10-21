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
