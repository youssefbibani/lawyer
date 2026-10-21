import { randomUUID } from "node:crypto";

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { Role } from "../../shared/api.js";
import { auth } from "../auth.js";
import { prisma } from "../db.js";
import { env, trustedOrigins } from "../env.js";
import type { Actor, AppEnv, Ctx } from "./context.js";
import { AppError } from "./errors.js";

/** Correlates logs, audit entries and error responses. Inbound ids are ignored (not trusted). */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const rid = randomUUID();
  c.set("requestId", rid);
  c.header("X-Request-Id", rid);
  await next();
});

function socketAddress(c: Context): string | null {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? null;
}

/**
 * Client address: the socket peer, or — only when TRUST_PROXY is set — the address appended by
 * the reverse proxy (right-most X-Forwarded-For entry).
 */
export const clientIp = createMiddleware<AppEnv>(async (c, next) => {
  let ip = socketAddress(c);
  if (env().TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
    if (forwarded?.length) ip = forwarded[forwarded.length - 1];
  }
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7);
  c.set("clientIp", ip);
  await next();
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated mutations: the request must come from a trusted origin
 * (browsers always send Origin on cross-site and same-origin POSTs). Session cookies are also
 * SameSite=Lax.
 */
export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (!origin || !trustedOrigins().includes(origin)) {
      throw new AppError("CSRF_REJECTED", "تم رفض الطلب لأنه لم يصدر من واجهة التطبيق.");
    }
  }
  await next();
});

/** Resolves the session (Better Auth) and the caller's ACTIVE office membership from the database. */
export const requireActor = createMiddleware<AppEnv>(async (c, next) => {
  const result = await auth().api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
  // Forward a refreshed session cookie, if Better Auth extended the session.
  result.headers?.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") c.header("Set-Cookie", value, { append: true });
  });
  const data = result.response;
  if (!data) throw new AppError("UNAUTHENTICATED", "انتهت الجلسة أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول من جديد.");

  let organizationId = data.session.activeOrganizationId ?? null;
  if (!organizationId) {
    const first = await prisma.member.findFirst({ where: { userId: data.user.id, deactivatedAt: null }, orderBy: { createdAt: "asc" }, select: { organizationId: true } });
    organizationId = first?.organizationId ?? null;
    if (organizationId) await prisma.session.update({ where: { id: data.session.id }, data: { activeOrganizationId: organizationId } });
  }
  if (!organizationId) throw new AppError("NO_ACTIVE_OFFICE", "حسابك غير مرتبط بأي مكتب نشط.");

  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId: data.user.id } },
    include: { organization: { include: { settings: true } } },
  });
  if (!member || member.deactivatedAt || !member.organization.settings) {
    throw new AppError("NO_ACTIVE_OFFICE", "عضويتك في هذا المكتب غير نشطة. تواصل مع مدير المكتب.");
  }
  const s = member.organization.settings;
  const actor: Actor = {
    userId: data.user.id,
    name: data.user.name,
    email: data.user.email,
    sessionId: data.session.id,
    organizationId,
    role: member.role as Role,
    office: {
      legalName: s.legalName,
      timeZone: s.timeZone,
      defaultCurrency: s.defaultCurrency,
      lawyersSeeAllCases: s.lawyersSeeAllCases,
      clerksSeeAllCases: s.clerksSeeAllCases,
      clerksCanRecordPayments: s.clerksCanRecordPayments,
    },
  };
  c.set("actor", actor);
  await next();
});

export function ctxOf(c: Context<AppEnv>): Ctx {
  const actor = c.get("actor");
  if (!actor) throw new AppError("UNAUTHENTICATED", "يرجى تسجيل الدخول.");
  return { actor, meta: { requestId: c.get("requestId"), ip: c.get("clientIp"), userAgent: c.req.header("user-agent") ?? null } };
}

/** Reads a JSON body. An empty body is `{}`; anything that is not JSON is rejected. */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "صيغة الطلب غير مدعومة (يجب إرسال JSON).");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_FAILED", "تعذّرت قراءة البيانات المرسلة (JSON غير صالح).");
  }
}

/** Fixed-window limiter for the API (per user, per client address), in memory. */
export function apiRateLimit(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `${c.get("actor")?.userId ?? "anon"}|${c.get("clientIp") ?? "?"}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    } else if (++entry.count > options.max) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new AppError("RATE_LIMITED", "طلبات كثيرة في وقت قصير. يرجى الانتظار قليلاً ثم إعادة المحاولة.");
    }
    await next();
  });
}
