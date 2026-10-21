import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { MeDTO, Role } from "../../shared/api.js";
import { auth } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv, Ctx } from "../http/context.js";
import { AppError, notFound } from "../http/errors.js";
import { apiRateLimit, ctxOf, readJson, requireActor } from "../http/middleware.js";
import { id, parse } from "../http/validation.js";
import { audit } from "../services/audit.js";
import { permissionsFor } from "../services/authorization.js";
import * as cases from "../services/cases.js";
import * as clients from "../services/clients.js";
import { dashboard } from "../services/dashboard.js";
import * as finance from "../services/finance.js";
import * as hearings from "../services/hearings.js";
import { getMailer } from "../services/mailer.js";
import * as reminders from "../services/reminders.js";
import * as settings from "../services/settings.js";
import * as tasks from "../services/tasks.js";

type C = Context<AppEnv>;

/** Path ids are validated; a malformed id is simply "not found". */
function param(c: C, name: string): string {
  const value = c.req.param(name);
  if (!value || !id.safeParse(value).success) throw notFound();
  return value;
}

const json = <T>(fn: (ctx: Ctx, c: C) => Promise<T>, status: 200 | 201 = 200) => async (c: C) => c.json((await fn(ctxOf(c), c)) as object, status);

async function me(ctx: Ctx): Promise<MeDTO> {
  const memberships = await prisma.member.findMany({ where: { userId: ctx.actor.userId, deactivatedAt: null }, include: { organization: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { twoFactorEnabled: true } });
  return {
    user: { id: ctx.actor.userId, name: ctx.actor.name, email: ctx.actor.email, twoFactorEnabled: !!user.twoFactorEnabled },
    office: { id: ctx.actor.organizationId, name: ctx.actor.office.legalName, timeZone: ctx.actor.office.timeZone, defaultCurrency: ctx.actor.office.defaultCurrency },
    role: ctx.actor.role,
    permissions: permissionsFor(ctx.actor.role, ctx.actor.office),
    offices: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role as Role })),
    mail: { configured: getMailer().configured },
  };
}

export function v1Routes() {
  const api = new Hono<AppEnv>();

  // Switching office needs a session but not an active office (it is how one is chosen).
  api.post("/me/active-office", async (c) => {
    const session = await auth().api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new AppError("UNAUTHENTICATED", "يرجى تسجيل الدخول.");
    const { organizationId } = parse(z.object({ organizationId: id }), await readJson(c));
    const member = await prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId: session.user.id } } });
    if (!member || member.deactivatedAt) throw notFound("المكتب");
    await prisma.session.update({ where: { id: session.session.id }, data: { activeOrganizationId: organizationId } });
    return c.json({ ok: true });
  });

  api.use("*", requireActor);
  api.use("*", apiRateLimit({ windowMs: 60_000, max: 600 }));

  api.get("/me", json((ctx) => me(ctx)));
  api.get(
    "/me/sessions",
    json(async (ctx) => {
      const rows = await prisma.session.findMany({ where: { userId: ctx.actor.userId, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" } });
      return rows.map((s) => ({ id: s.id, createdAt: s.createdAt.toISOString(), lastActiveAt: s.updatedAt.toISOString(), ipAddress: s.ipAddress, userAgent: s.userAgent, current: s.id === ctx.actor.sessionId }));
    }),
  );
  api.delete(
    "/me/sessions/:id",
    json(async (ctx, c) => {
      const sessionId = param(c, "id");
      if (sessionId === ctx.actor.sessionId) throw new AppError("CONFLICT", "لإنهاء الجلسة الحالية استعمل تسجيل الخروج.");
      const result = await prisma.session.deleteMany({ where: { id: sessionId, userId: ctx.actor.userId } });
      if (result.count === 0) throw notFound("الجلسة");
      await audit(prisma, ctx, { resourceType: "session", resourceId: sessionId, operation: "session.revoke", summary: "إنهاء جلسة على جهاز آخر" });
      return { ok: true };
    }),
  );
  api.get("/members", json((ctx, c) => settings.listMembers(ctx, c.req.query("includeInactive") === "true")));
  api.get("/dashboard", json((ctx) => dashboard(ctx)));

  // Clients
  api.get("/clients", json((ctx, c) => clients.listClients(ctx, c.req.query())));
  api.post("/clients", json(async (ctx, c) => clients.createClient(ctx, await readJson(c)), 201));
  api.get("/clients/:id", json((ctx, c) => clients.getClient(ctx, param(c, "id"))));
  api.patch("/clients/:id", json(async (ctx, c) => clients.updateClient(ctx, param(c, "id"), await readJson(c))));
  api.post("/clients/:id/archive", json(async (ctx, c) => clients.setClientArchived(ctx, param(c, "id"), true, await readJson(c))));
  api.post("/clients/:id/unarchive", json(async (ctx, c) => clients.setClientArchived(ctx, param(c, "id"), false, await readJson(c))));

  // Cases
  api.get("/cases", json((ctx, c) => cases.listCases(ctx, c.req.query())));
  api.post("/cases", json(async (ctx, c) => cases.createCase(ctx, await readJson(c)), 201));
  api.get("/cases/:id", json((ctx, c) => cases.getCase(ctx, param(c, "id"))));
  api.patch("/cases/:id", json(async (ctx, c) => cases.updateCase(ctx, param(c, "id"), await readJson(c))));
  api.post("/cases/:id/status", json(async (ctx, c) => cases.changeCaseStatus(ctx, param(c, "id"), await readJson(c))));
  api.post("/cases/:id/assign", json(async (ctx, c) => cases.assignCaseLawyer(ctx, param(c, "id"), await readJson(c))));
  api.put("/cases/:id/members", json(async (ctx, c) => cases.setCaseMembers(ctx, param(c, "id"), await readJson(c))));
  api.post("/cases/:id/clients", json(async (ctx, c) => cases.addCaseClient(ctx, param(c, "id"), await readJson(c))));
  api.delete("/cases/:id/clients/:clientId", json(async (ctx, c) => cases.removeCaseClient(ctx, param(c, "id"), param(c, "clientId"), await readJson(c))));
  api.get("/cases/:id/notes", json((ctx, c) => cases.listNotes(ctx, param(c, "id"))));
  api.post("/cases/:id/notes", json(async (ctx, c) => cases.addNote(ctx, param(c, "id"), await readJson(c)), 201));
  api.get("/cases/:id/timeline", json((ctx, c) => cases.caseTimeline(ctx, param(c, "id"))));

  // Hearings
  api.get("/hearings", json((ctx, c) => hearings.listHearings(ctx, c.req.query())));
  api.post("/hearings", json(async (ctx, c) => hearings.createHearing(ctx, await readJson(c)), 201));
  api.get("/hearings/conflicts", json((ctx, c) => hearings.previewConflicts(ctx, c.req.query())));
  api.get("/hearings/conflict-groups", json((ctx) => hearings.conflictGroups(ctx)));
  api.get("/hearings/:id", json((ctx, c) => hearings.getHearing(ctx, param(c, "id"))));
  api.patch("/hearings/:id", json(async (ctx, c) => hearings.updateHearing(ctx, param(c, "id"), await readJson(c))));
  api.post("/hearings/:id/status", json(async (ctx, c) => hearings.changeHearingStatus(ctx, param(c, "id"), await readJson(c))));
  api.get("/hearings/:id/history", json((ctx, c) => hearings.hearingHistory(ctx, param(c, "id"))));

  // Fees
  api.get("/fees", json((ctx, c) => finance.listAgreements(ctx, c.req.query())));
  api.post("/fees", async (c) => {
    const { replayed, ...agreement } = await finance.createAgreement(ctxOf(c), await readJson(c), c.req.header("idempotency-key"));
    if (replayed) c.header("Idempotent-Replayed", "true");
    return c.json(agreement, replayed ? 200 : 201);
  });
  api.get("/fees/totals", json((ctx) => finance.financeTotals(ctx)));
  api.get("/fees/:id", json((ctx, c) => finance.getAgreement(ctx, param(c, "id"))));
  api.patch("/fees/:id", json(async (ctx, c) => finance.updateAgreement(ctx, param(c, "id"), await readJson(c))));
  api.post("/fees/:id/cancel", json(async (ctx, c) => finance.cancelAgreement(ctx, param(c, "id"), await readJson(c))));

  // Payments (financial mutations require an Idempotency-Key)
  api.get("/payments", json((ctx, c) => finance.listPayments(ctx, c.req.query())));
  api.post("/payments", async (c) => {
    const result = await finance.recordPayment(ctxOf(c), await readJson(c), c.req.header("idempotency-key"));
    if (result.replayed) c.header("Idempotent-Replayed", "true");
    return c.json(result, result.replayed ? 200 : 201);
  });
  api.get("/payments/:id", json((ctx, c) => finance.getPayment(ctx, param(c, "id"))));
  api.post("/payments/:id/void", json(async (ctx, c) => finance.voidPayment(ctx, param(c, "id"), await readJson(c))));

  // Receipts
  api.get("/receipts", json((ctx, c) => finance.listReceipts(ctx, c.req.query())));
  api.get("/receipts/:id", json((ctx, c) => finance.getReceipt(ctx, param(c, "id"))));
  api.get("/receipts/:id/pdf", async (c) => {
    const file = await finance.receiptPdf(ctxOf(c), param(c, "id"));
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `${c.req.query("download") === "1" ? "attachment" : "inline"}; filename="${file.filename}"`);
    c.header("X-Receipt-Status", file.status);
    c.header("Cache-Control", "private, no-store");
    return c.body(new Uint8Array(file.pdf));
  });
  api.post("/receipts/:id/pdf", json((ctx, c) => finance.retryReceiptPdf(ctx, param(c, "id"))));

  // Tasks
  api.get("/tasks", json((ctx, c) => tasks.listTasks(ctx, c.req.query())));
  api.get("/tasks/summary", json((ctx, c) => tasks.taskSummary(ctx, c.req.query())));
  api.get("/tasks/conflicts", json((ctx, c) => tasks.previewTaskConflicts(ctx, c.req.query())));
  api.post("/tasks", json(async (ctx, c) => tasks.createTask(ctx, await readJson(c)), 201));
  api.get("/tasks/:id", json((ctx, c) => tasks.getTask(ctx, param(c, "id"))));
  api.patch("/tasks/:id", json(async (ctx, c) => tasks.updateTask(ctx, param(c, "id"), await readJson(c))));
  api.post("/tasks/:id/complete", json(async (ctx, c) => tasks.completeTask(ctx, param(c, "id"), await readJson(c))));
  api.post("/tasks/:id/reopen", json(async (ctx, c) => tasks.reopenTask(ctx, param(c, "id"), await readJson(c))));
  api.post("/tasks/:id/cancel", json(async (ctx, c) => tasks.cancelTask(ctx, param(c, "id"), await readJson(c))));

  // Reminders
  api.get("/reminders", json((ctx, c) => reminders.listMyReminders(ctx, c.req.query())));
  api.get("/reminders/inbox", json((ctx) => reminders.inbox(ctx)));
  api.post("/reminders", json(async (ctx, c) => reminders.createHearingReminder(ctx, await readJson(c)), 201));
  api.post("/reminders/:id/read", json((ctx, c) => reminders.markRead(ctx, param(c, "id"))));
  api.post("/reminders/:id/cancel", json((ctx, c) => reminders.cancelReminder(ctx, param(c, "id"))));

  // Settings
  api.get("/settings", json((ctx) => settings.getSettings(ctx)));
  api.patch("/settings/office", json(async (ctx, c) => settings.updateOffice(ctx, await readJson(c))));
  api.patch("/settings/preferences", json(async (ctx, c) => settings.updatePreferences(ctx, await readJson(c))));
  api.patch("/settings/profile", json(async (ctx, c) => settings.updateProfile(ctx, await readJson(c))));
  api.get("/settings/members", json((ctx) => settings.listMembers(ctx, true)));
  api.post("/settings/members", json(async (ctx, c) => settings.createMember(ctx, await readJson(c)), 201));
  api.patch("/settings/members/:userId", json(async (ctx, c) => settings.updateMemberRole(ctx, param(c, "userId"), await readJson(c))));
  api.post("/settings/members/:userId/deactivate", json((ctx, c) => settings.setMemberActive(ctx, param(c, "userId"), false)));
  api.post("/settings/members/:userId/reactivate", json((ctx, c) => settings.setMemberActive(ctx, param(c, "userId"), true)));
  api.post("/settings/members/:userId/password", json(async (ctx, c) => settings.resetMemberPassword(ctx, param(c, "userId"), await readJson(c))));
  api.get("/settings/audit", json((ctx, c) => settings.listAudit(ctx, c.req.query())));

  return api;
}
