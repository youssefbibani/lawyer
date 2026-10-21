/**
 * Production / development entry point.
 *   development: tsx watch server/index.ts   (Vite serves the SPA on :8080 and proxies /api here)
 *   production:  node dist-server/server/index.js with SERVE_STATIC=true (serves dist/ as well)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { closePdfBrowser } from "./services/receipt-pdf.js";
import { startReminderWorker, stopReminderWorker } from "./services/reminders.js";

const config = env();
const app = createApp();

if (config.SERVE_STATIC) {
  const root = path.resolve(process.cwd(), "dist");
  const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
  app.use("/assets/*", serveStatic({ root: "./dist", onFound: (_p, c) => c.header("Cache-Control", "public, max-age=31536000, immutable") }));
  app.use("*", serveStatic({ root: "./dist" }));
  // SPA fallback: every non-API route renders the application shell.
  app.get("*", (c) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "same-origin");
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
}

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: process.env.HOST ?? "0.0.0.0" }, (info) => {
  console.info(`[server] listening on http://${info.address}:${info.port} (${config.NODE_ENV})`);
});

if (config.REMINDER_WORKER) startReminderWorker();

async function shutdown(signal: string) {
  console.info(`[server] ${signal} received, shutting down`);
  stopReminderWorker();
  server.close();
  await closePdfBrowser();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
