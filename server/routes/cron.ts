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
