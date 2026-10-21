import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { prisma } from "./db.js";
import type { AppEnv } from "./http/context.js";
import { AppError, errorBody, fromDatabase } from "./http/errors.js";
import { clientIp, ctxOf, originCheck, requestId } from "./http/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { v1Routes } from "./routes/v1.js";
import { audit } from "./services/audit.js";

/** Logs a failure without request bodies, query values or anything else that may hold client data. */
function logFailure(requestId: string, err: unknown) {
  const e = err as { name?: string; code?: string; message?: string };
  const firstLine = String(e?.message ?? "").split("\n").find((l) => l.trim()) ?? "";
  console.error(`[api] request=${requestId} ${e?.name ?? "Error"}${e?.code ? ` code=${e.code}` : ""}: ${firstLine.slice(0, 200)}`);
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestId, clientIp);
  app.use(
    "/api/*",
    secureHeaders({ crossOriginResourcePolicy: "same-origin", xFrameOptions: "DENY", referrerPolicy: "no-referrer" }),
    async (c, next) => {
      await next();
      if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    },
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json(errorBody(new AppError("PAYLOAD_TOO_LARGE", "حجم الطلب يتجاوز الحد المسموح به."), c.get("requestId")), 413),
    }),
  );

  app.get("/api/health", async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return c.json({ status: "ok", database: "ok" });
    } catch {
      return c.json({ status: "degraded", database: "unavailable" }, 503);
    }
  });

  // CSRF: mutating requests must come from a trusted origin (sign-in included, against login CSRF).
  app.use("/api/auth/*", originCheck);
  app.route("/api/auth", authRoutes());
  app.use("/api/v1/*", originCheck);
  app.route("/api/v1", v1Routes());
  app.all("/api/*", (c) => c.json(errorBody(new AppError("NOT_FOUND", "المسار غير موجود."), c.get("requestId")), 404));

  app.onError(async (err, c) => {
    const rid = c.get("requestId");
    let error: AppError | null = err instanceof AppError ? err : fromDatabase(err);
    if (!error && err instanceof HTTPException) {
      error = err.status === 413 ? new AppError("PAYLOAD_TOO_LARGE", "حجم الطلب يتجاوز الحد المسموح به.") : new AppError("VALIDATION_FAILED", "طلب غير صالح.");
    }
    if (!error) {
      logFailure(rid, err);
      error = new AppError("INTERNAL", "حدث خطأ غير متوقع في الخادم. أعد المحاولة، وإن تكرر الخطأ فاذكر رقم الطلب للدعم التقني.");
    } else if (error.status >= 500) {
      logFailure(rid, err);
    }
    if (error.code === "FORBIDDEN" && c.get("actor")) {
      // Denied attempts are part of the security record.
      await audit(prisma, ctxOf(c), {
        resourceType: "authorization",
        operation: `${c.req.method} ${c.req.routePath}`,
        outcome: "DENIED",
        summary: "محاولة عملية غير مصرّح بها",
        after: error.options.data,
      }).catch(() => undefined);
    }
    return c.json(errorBody(error, rid), error.status as 400);
  });

  return app;
}
