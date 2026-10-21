/**
 * Better Auth endpoints, exposed through an allowlist. Organization-plugin mutations (create
 * office, invite, change roles, remove members) are NOT exposed: membership changes go through
 * /api/v1/settings/members, which enforces office policy and writes the audit log.
 */
import { createHash } from "node:crypto";

import { Hono } from "hono";

import { auth, CLIENT_IP_HEADER } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../http/context.js";
import { AppError } from "../http/errors.js";
import { auditAnonymous } from "../services/audit.js";
import { getMailer } from "../services/mailer.js";

const ALLOWED: [method: string, path: RegExp][] = [
  ["POST", /^\/sign-in\/email$/],
  ["POST", /^\/sign-out$/],
  ["GET", /^\/get-session$/],
  ["POST", /^\/request-password-reset$/],
  ["GET", /^\/reset-password\/[^/]+$/],
  ["POST", /^\/reset-password$/],
  ["POST", /^\/change-password$/],
  // Session listing / revocation by id: /api/v1/me/sessions (tokens are never sent to the page).
  ["POST", /^\/revoke-other-sessions$/],
  ["POST", /^\/two-factor\/(enable|disable|verify-totp|verify-backup-code|get-totp-uri|generate-backup-codes)$/],
  ["GET", /^\/ok$/],
];

/** Per-account throttling, in addition to Better Auth's per-address limits. */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;

/**
 * The session token lives in an httpOnly cookie; Better Auth also echoes it in some JSON bodies
 * (sign-in, get-session, 2FA verification). It is removed so page scripts can never read it.
 */
async function withoutTokens(response: Response): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: response.status, headers: response.headers });
  }
  if (body && typeof body === "object") {
    const b = body as { token?: unknown; session?: { token?: unknown } | null };
    delete b.token;
    if (b.session && typeof b.session === "object") delete b.session.token;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

const accountKey = (email: string) => createHash("sha256").update(`login:${email.trim().toLowerCase()}`).digest("hex");

async function registerFailure(key: string, now: Date) {
  const existing = await prisma.loginThrottle.findUnique({ where: { key } });
  const fresh = !existing || now.getTime() - existing.firstFailureAt.getTime() > LOGIN_FAILURE_WINDOW_MS;
  const failures = fresh ? 1 : existing!.failures + 1;
  const lockedUntil = failures >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_LOCK_MS) : null;
  await prisma.loginThrottle.upsert({
    where: { key },
    create: { key, failures, firstFailureAt: now, lockedUntil },
    update: { failures, ...(fresh ? { firstFailureAt: now } : {}), lockedUntil },
  });
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  app.all("/*", async (c) => {
    const path = c.req.path.replace(/^\/api\/auth/, "") || "/";
    const method = c.req.method;
    if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
      throw new AppError("NOT_FOUND", "المسار غير موجود.");
    }

    const headers = new Headers(c.req.raw.headers);
    headers.delete(CLIENT_IP_HEADER);
    const ip = c.get("clientIp");
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();

    if (method === "POST" && path === "/request-password-reset" && !getMailer().configured) {
      // Honest and identical for every address: no e-mail can be sent at all.
      throw new AppError("SERVICE_UNAVAILABLE", "إعادة تعيين كلمة المرور بالبريد غير متاحة: خدمة البريد غير مهيأة على الخادم. تواصل مع مدير المكتب لتعيين كلمة مرور جديدة.");
    }

    const signIn = method === "POST" && path === "/sign-in/email";
    let key: string | null = null;
    if (signIn && body) {
      try {
        const email = (JSON.parse(Buffer.from(body).toString("utf8")) as { email?: unknown }).email;
        if (typeof email === "string" && email.length <= 254) key = accountKey(email);
      } catch {
        // Malformed body: Better Auth answers with a validation error.
      }
      if (key) {
        const t = await prisma.loginThrottle.findUnique({ where: { key } });
        if (t?.lockedUntil && t.lockedUntil > new Date()) {
          c.header("Retry-After", String(Math.ceil((t.lockedUntil.getTime() - Date.now()) / 1000)));
          throw new AppError("RATE_LIMITED", "تم إيقاف تسجيل الدخول لهذا الحساب مؤقتاً بعد محاولات فاشلة متكررة. أعد المحاولة لاحقاً.");
        }
      }
    }

    const response = await auth().handler(new Request(c.req.url, { method, headers, body }));

    if (signIn) {
      const now = new Date();
      const meta = { ip, userAgent: c.req.header("user-agent") ?? null, requestId: c.get("requestId") };
      if (response.status === 401 && key) {
        await registerFailure(key, now);
        await auditAnonymous(prisma, { ...meta, resourceType: "session", operation: "auth.sign_in", outcome: "FAILURE", summary: "محاولة دخول فاشلة" });
      } else if (response.ok) {
        if (key) await prisma.loginThrottle.deleteMany({ where: { key } });
        const payload = (await response.clone().json().catch(() => null)) as { user?: { id?: string }; twoFactorRedirect?: boolean } | null;
        if (payload?.user?.id) {
          const m = await prisma.member.findFirst({ where: { userId: payload.user.id, deactivatedAt: null }, orderBy: { createdAt: "asc" }, select: { organizationId: true } });
          await auditAnonymous(prisma, { ...meta, organizationId: m?.organizationId, actorId: payload.user.id, resourceType: "session", operation: "auth.sign_in", summary: "تسجيل الدخول" });
        }
      }
    }
    return withoutTokens(response);
  });

  return app;
}
