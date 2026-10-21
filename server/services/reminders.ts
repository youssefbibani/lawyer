/**
 * Reminder delivery. In-app reminders become visible in the recipient's inbox when due; email
 * reminders go through the configured SMTP service. Without one, the reminder is marked
 * NOT_CONFIGURED — never reported as sent.
 */
import { z } from "zod";

import type { Paginated, ReminderDTO } from "../../shared/api.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound } from "../http/errors.js";
import { id, pageArgs, pagination, parse } from "../http/validation.js";
import { utcToZoned } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, caseScope } from "./authorization.js";
import { reminderDTO, reminderInclude, reminderTitle } from "./dto.js";
import { getMailer } from "./mailer.js";

/** Reminders more than this late are not delivered (stale) but marked as such. */
export const MAX_LATENESS_MS = 12 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

const listQuery = pagination.extend({ status: z.enum(["PENDING", "SENT", "FAILED", "CANCELLED", "NOT_CONFIGURED"]).optional() });

export async function listMyReminders(ctx: Ctx, raw: unknown): Promise<Paginated<ReminderDTO>> {
  const q = parse(listQuery, raw);
  const where = { organizationId: ctx.actor.organizationId, recipientId: ctx.actor.userId, ...(q.status ? { status: q.status } : {}) };
  const [total, rows] = await prisma.$transaction([
    prisma.reminder.count({ where }),
    prisma.reminder.findMany({ where, include: reminderInclude, orderBy: { scheduledAt: "desc" }, ...pageArgs(q) }),
  ]);
  return { items: rows.map(reminderDTO), page: q.page, pageSize: q.pageSize, total };
}

/** Delivered, unread in-app reminders for the current user. */
export async function inbox(ctx: Ctx): Promise<{ items: ReminderDTO[]; unread: number }> {
  const where = { organizationId: ctx.actor.organizationId, recipientId: ctx.actor.userId, channel: "IN_APP" as const, status: "SENT" as const, readAt: null };
  const [unread, rows] = await prisma.$transaction([
    prisma.reminder.count({ where }),
    prisma.reminder.findMany({ where, include: reminderInclude, orderBy: { deliveredAt: "desc" }, take: 30 }),
  ]);
  return { items: rows.map(reminderDTO), unread };
}

export async function markRead(ctx: Ctx, reminderId: string): Promise<ReminderDTO> {
  const r = await prisma.reminder.findFirst({ where: { id: reminderId, organizationId: ctx.actor.organizationId, recipientId: ctx.actor.userId } });
  if (!r) throw notFound("التذكير");
  if (!r.readAt) await prisma.reminder.update({ where: { id: reminderId }, data: { readAt: new Date() } });
  return reminderDTO(await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId }, include: reminderInclude }));
}

const hearingReminderBody = z.object({
  hearingId: id,
  minutesBefore: z.number().int().min(0).max(30 * 24 * 60).default(1440),
  channel: z.enum(["IN_APP", "EMAIL"]).default("IN_APP"),
});

export async function createHearingReminder(ctx: Ctx, raw: unknown): Promise<ReminderDTO> {
  assertCan(ctx, "task:write");
  const input = parse(hearingReminderBody, raw);
  const created = await prisma.$transaction(async (tx) => {
    const h = await tx.hearing.findFirst({ where: { id: input.hearingId, organizationId: ctx.actor.organizationId, case: caseScope(ctx.actor) } });
    if (!h) throw notFound("الجلسة");
    if (h.status !== "SCHEDULED") throw new AppError("CONFLICT", "لا يمكن التذكير بجلسة غير مبرمجة.");
    const scheduledAt = new Date(h.startsAt.getTime() - input.minutesBefore * 60_000);
    if (scheduledAt.getTime() < Date.now()) throw new AppError("VALIDATION_FAILED", "موعد التذكير المطلوب قد مضى.");
    const r = await tx.reminder.create({
      data: { organizationId: ctx.actor.organizationId, hearingId: h.id, recipientId: ctx.actor.userId, scheduledAt, channel: input.channel, createdById: ctx.actor.userId },
      include: reminderInclude,
    });
    await audit(tx, ctx, { resourceType: "reminder", resourceId: r.id, caseId: h.caseId, operation: "reminder.hearing.create", summary: "إنشاء تذكير بجلسة" });
    return r;
  });
  return reminderDTO(created);
}

export async function cancelReminder(ctx: Ctx, reminderId: string): Promise<ReminderDTO> {
  const r = await prisma.reminder.findFirst({ where: { id: reminderId, organizationId: ctx.actor.organizationId } });
  if (!r || (r.recipientId !== ctx.actor.userId && r.createdById !== ctx.actor.userId && ctx.actor.role !== "admin")) throw notFound("التذكير");
  if (r.status !== "PENDING") throw new AppError("CONFLICT", "لا يمكن إلغاء تذكير أُرسل أو أُغلق.");
  await prisma.reminder.update({ where: { id: reminderId }, data: { status: "CANCELLED" } });
  return reminderDTO(await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId }, include: reminderInclude }));
}

// ——— Worker ———

export interface DeliveryReport {
  processed: number;
  sent: number;
  failed: number;
  notConfigured: number;
  cancelled: number;
}

/**
 * Delivers due reminders. Rows are claimed with FOR UPDATE SKIP LOCKED plus a short lease, so
 * several server instances never deliver the same reminder twice.
 */
export async function deliverDueReminders(now: Date = new Date(), limit = 50): Promise<DeliveryReport> {
  const report: DeliveryReport = { processed: 0, sent: 0, failed: 0, notConfigured: 0, cancelled: 0 };
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM reminders
      WHERE status = 'PENDING' AND COALESCE("nextAttemptAt", "scheduledAt") <= ${now}
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length) {
      await tx.reminder.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) } });
    }
    return rows.map((r) => r.id);
  });

  const mailer = getMailer();
  for (const reminderId of claimed) {
    report.processed++;
    const r = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: {
        task: { select: { status: true, title: true, dueAt: true } },
        hearing: { select: { status: true, type: true, startsAt: true, timeZone: true, case: { select: { reference: true } } } },
        recipient: { select: { deactivatedAt: true, user: { select: { email: true, name: true } }, preferences: true } },
      },
    });
    if (!r || r.status !== "PENDING") continue;
    const close = (status: "CANCELLED" | "NOT_CONFIGURED", lastError: string) =>
      prisma.reminder.update({ where: { id: r.id }, data: { status, lastError, lastAttemptAt: now, nextAttemptAt: null } });

    if (r.recipient.deactivatedAt) {
      await close("CANCELLED", "المستلم لم يعد عضواً نشطاً في المكتب.");
      report.cancelled++;
      continue;
    }
    if ((r.task && r.task.status !== "OPEN") || (r.hearing && r.hearing.status !== "SCHEDULED")) {
      await close("CANCELLED", "أُغلقت المهمة أو تغيّرت حالة الجلسة قبل موعد التذكير.");
      report.cancelled++;
      continue;
    }
    const prefs = r.recipient.preferences;
    if (prefs && ((r.taskId && !prefs.taskReminders) || (r.hearingId && !prefs.hearingReminders))) {
      await close("CANCELLED", "أوقف المستلم هذا النوع من التذكيرات في إعداداته.");
      report.cancelled++;
      continue;
    }
    if (now.getTime() - r.scheduledAt.getTime() > MAX_LATENESS_MS) {
      await close("CANCELLED", "انقضى أجل التذكير قبل إرساله (الخادم كان متوقفاً).");
      report.cancelled++;
      continue;
    }

    if (r.channel === "IN_APP") {
      await prisma.reminder.update({ where: { id: r.id }, data: { status: "SENT", deliveredAt: now, attempts: { increment: 1 }, lastAttemptAt: now, nextAttemptAt: null, lastError: null } });
      report.sent++;
      continue;
    }

    if (!mailer.configured) {
      await close("NOT_CONFIGURED", "خدمة البريد الإلكتروني غير مهيأة على الخادم: لم يُرسل التذكير.");
      report.notConfigured++;
      continue;
    }
    const title = reminderTitle(r);
    const office = await prisma.officeSettings.findUnique({ where: { organizationId: r.organizationId }, select: { timeZone: true } });
    const when = r.hearing ? utcToZoned(r.hearing.startsAt, r.hearing.timeZone) : r.task?.dueAt ? utcToZoned(r.task.dueAt, office?.timeZone ?? "Africa/Tunis") : null;
    const link = `${env().BETTER_AUTH_URL}${r.taskId ? `/app/tasks?focus=${r.taskId}` : "/app/agenda"}`;
    const result = await mailer.send({
      to: r.recipient.user.email,
      subject: `تذكير: ${title}`.slice(0, 150),
      text: `${r.recipient.user.name}،\n\nتذكير: ${title}${when ? `\nالموعد: ${when.date} على الساعة ${when.time}` : ""}\n\n${link}\n\n— قصر العدالة`,
    });
    const attempts = r.attempts + 1;
    if (result.ok) {
      await prisma.reminder.update({ where: { id: r.id }, data: { status: "SENT", deliveredAt: now, attempts, lastAttemptAt: now, nextAttemptAt: null, lastError: null } });
      report.sent++;
    } else if (attempts >= r.maxAttempts) {
      await prisma.reminder.update({ where: { id: r.id }, data: { status: "FAILED", attempts, lastAttemptAt: now, nextAttemptAt: null, lastError: `تعذّر الإرسال: ${result.error ?? "خطأ غير معروف"}`.slice(0, 300) } });
      report.failed++;
    } else {
      const backoff = 2 ** attempts * 60_000;
      await prisma.reminder.update({ where: { id: r.id }, data: { attempts, lastAttemptAt: now, nextAttemptAt: new Date(now.getTime() + backoff), lastError: `محاولة ${attempts} فشلت: ${result.error ?? ""}`.slice(0, 300) } });
      report.failed++;
    }
  }
  return report;
}

let timer: NodeJS.Timeout | undefined;

export function startReminderWorker(intervalMs = 30_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await deliverDueReminders();
      if (report.processed) console.info(`[reminders] processed=${report.processed} sent=${report.sent} failed=${report.failed} not_configured=${report.notConfigured} cancelled=${report.cancelled}`);
    } catch (err) {
      console.error("[reminders] worker error:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
}

export function stopReminderWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
