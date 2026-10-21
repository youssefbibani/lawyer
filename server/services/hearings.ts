import { Prisma } from "@prisma/client";
import { z } from "zod";

import { HEARING_STATUSES, type HearingConflictsDTO, type HearingDTO, type HearingEventDTO, type Paginated } from "../../shared/api.js";
import { prisma, type Tx } from "../db.js";
import type { Actor, Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { hhmm, id, isoDate, optionalText, pageArgs, parse, requiredText, version } from "../http/validation.js";
import { addDaysToDate, dayRange, todayIn, utcToZoned, zonedToUtc } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, caseScope, loadAccessibleCase } from "./authorization.js";
import { hearingDTO, hearingInclude } from "./dto.js";

const MAX_DURATION = 1440;
const duration = z.number({ invalid_type_error: "المدة غير صالحة" }).int().min(5, "المدة الدنيا 5 دقائق").max(MAX_DURATION, "المدة القصوى 24 ساعة");

const createBody = z.object({
  caseId: id,
  // A hearing always has an explicit time: the API never assumes one.
  date: isoDate,
  time: hhmm,
  durationMinutes: duration.default(60),
  court: requiredText(200, "يرجى إدخال المحكمة"),
  chamber: optionalText(200),
  room: optionalText(100),
  type: requiredText(100, "يرجى إدخال نوع الجلسة"),
  notes: optionalText(2000),
  acknowledgeConflicts: z.boolean().default(false),
});

const updateBody = z.object({
  date: isoDate.optional(),
  time: hhmm.optional(),
  durationMinutes: duration.optional(),
  court: requiredText(200, "يرجى إدخال المحكمة").optional(),
  chamber: optionalText(200),
  room: optionalText(100),
  type: requiredText(100, "يرجى إدخال نوع الجلسة").optional(),
  notes: optionalText(2000),
  reason: optionalText(500),
  acknowledgeConflicts: z.boolean().default(false),
  version,
});

const statusBody = z
  .object({
    status: z.enum(["HELD", "POSTPONED", "CANCELLED"], { errorMap: () => ({ message: "حالة غير صالحة" }) }),
    reason: optionalText(500),
    /** For POSTPONED: the new hearing date/time, created as a follow-up hearing. */
    next: z.object({ date: isoDate, time: hhmm }).optional(),
    acknowledgeConflicts: z.boolean().default(false),
    version,
  })
  .refine((v) => v.status === "HELD" || !!v.reason, { message: "يرجى ذكر سبب التأجيل أو الإلغاء", path: ["reason"] })
  .refine((v) => v.status === "POSTPONED" || !v.next, { message: "الموعد الجديد يخص التأجيل فقط", path: ["next"] });

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  caseId: id.optional(),
  status: z.enum(HEARING_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

const conflictQuery = z.object({
  caseId: id,
  date: isoDate,
  time: hhmm,
  durationMinutes: z.coerce.number().int().min(5).max(MAX_DURATION).default(60),
  excludeId: id.optional(),
});

function instant(date: string, time: string, tz: string): Date {
  const at = zonedToUtc(date, time, tz);
  if (!at) throw new AppError("VALIDATION_FAILED", "هذا التوقيت غير موجود في المنطقة الزمنية للمكتب.", { details: [{ path: "time", message: "توقيت غير موجود" }] });
  return at;
}

const hearingWhere = (actor: Actor): Prisma.HearingWhereInput => ({ organizationId: actor.organizationId, case: caseScope(actor) });

/** Serialises conflict checks for one lawyer so two concurrent bookings cannot both miss each other. */
async function lockLawyerSchedule(tx: Tx, organizationId: string, lawyerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hearing:${organizationId}:${lawyerId}`}, 0))`;
}

/** Overlapping SCHEDULED hearings of the same assigned lawyer. Details only for cases the actor may see. */
export async function findConflicts(
  tx: Tx,
  actor: Actor,
  args: { lawyerId: string; startsAt: Date; durationMinutes: number; excludeId?: string },
): Promise<HearingConflictsDTO> {
  const start = args.startsAt.getTime();
  const end = start + args.durationMinutes * 60_000;
  const candidates = await tx.hearing.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "SCHEDULED",
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      startsAt: { lt: new Date(end), gt: new Date(start - MAX_DURATION * 60_000) },
      case: { assignedLawyerId: args.lawyerId },
    },
    include: hearingInclude,
    orderBy: { startsAt: "asc" },
  });
  const overlapping = candidates.filter((h) => h.startsAt.getTime() + h.durationMinutes * 60_000 > start);
  if (!overlapping.length) return { hearings: [], hiddenCount: 0 };
  const visible = new Set(
    (await tx.case.findMany({ where: { AND: [{ id: { in: overlapping.map((h) => h.caseId) } }, caseScope(actor)] }, select: { id: true } })).map((c) => c.id),
  );
  const shown = overlapping.filter((h) => visible.has(h.caseId));
  return { hearings: shown.map(hearingDTO), hiddenCount: overlapping.length - shown.length };
}

function assertNoConflicts(conflicts: HearingConflictsDTO, acknowledged: boolean) {
  if (!acknowledged && conflicts.hearings.length + conflicts.hiddenCount > 0) {
    throw new AppError("HEARING_CONFLICT", "يتعارض هذا الموعد مع جلسة أخرى للمحامي نفسه. أكّد البرمجة رغم التعارض أو غيّر الموعد.", { data: conflicts });
  }
}

export async function previewConflicts(ctx: Ctx, raw: unknown): Promise<HearingConflictsDTO> {
  assertCan(ctx, "case:read");
  const q = parse(conflictQuery, raw);
  const c = await loadAccessibleCase(prisma, ctx.actor, q.caseId);
  return findConflicts(prisma, ctx.actor, {
    lawyerId: c.assignedLawyerId,
    startsAt: instant(q.date, q.time, ctx.actor.office.timeZone),
    durationMinutes: q.durationMinutes,
    excludeId: q.excludeId,
  });
}

export async function listHearings(ctx: Ctx, raw: unknown): Promise<Paginated<HearingDTO>> {
  assertCan(ctx, "case:read");
  const q = parse(listQuery, raw);
  const tz = ctx.actor.office.timeZone;
  const range: Prisma.DateTimeFilter = {};
  if (q.from) range.gte = dayRange(q.from, tz).start;
  if (q.to) range.lt = dayRange(q.to, tz).end;
  const where: Prisma.HearingWhereInput = {
    AND: [hearingWhere(ctx.actor), q.caseId ? { caseId: q.caseId } : {}, q.status ? { status: q.status } : {}, q.from || q.to ? { startsAt: range } : {}],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.hearing.count({ where }),
    prisma.hearing.findMany({ where, include: hearingInclude, orderBy: [{ startsAt: "asc" }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(hearingDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getHearing(ctx: Ctx, hearingId: string): Promise<HearingDTO> {
  assertCan(ctx, "case:read");
  const h = await prisma.hearing.findFirst({ where: { AND: [{ id: hearingId }, hearingWhere(ctx.actor)] }, include: hearingInclude });
  if (!h) throw notFound("الجلسة");
  return hearingDTO(h);
}

export async function hearingHistory(ctx: Ctx, hearingId: string): Promise<HearingEventDTO[]> {
  await getHearing(ctx, hearingId);
  const events = await prisma.hearingEvent.findMany({
    where: { hearingId, organizationId: ctx.actor.organizationId },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    reason: e.reason,
    before: (e.before as Record<string, unknown> | null) ?? null,
    after: (e.after as Record<string, unknown> | null) ?? null,
    actor: { userId: e.actor.id, name: e.actor.name },
    createdAt: e.createdAt.toISOString(),
  }));
}

/** Upcoming groups of overlapping hearings (same lawyer) among hearings the actor may see. */
export async function conflictGroups(ctx: Ctx, fromDate?: string): Promise<HearingDTO[][]> {
  const tz = ctx.actor.office.timeZone;
  const from = dayRange(fromDate ?? todayIn(tz), tz).start;
  const rows = await prisma.hearing.findMany({
    where: { AND: [hearingWhere(ctx.actor), { status: "SCHEDULED", startsAt: { gte: from } }] },
    include: hearingInclude,
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  const groups: (typeof rows)[] = [];
  const byLawyer = new Map<string, typeof rows>();
  for (const h of rows) byLawyer.set(h.case.assignedLawyer.userId, [...(byLawyer.get(h.case.assignedLawyer.userId) ?? []), h]);
  for (const list of byLawyer.values()) {
    let current: typeof rows = [];
    let currentEnd = 0;
    for (const h of list) {
      const start = h.startsAt.getTime();
      if (current.length && start < currentEnd) {
        current.push(h);
        currentEnd = Math.max(currentEnd, start + h.durationMinutes * 60_000);
      } else {
        if (current.length > 1) groups.push(current);
        current = [h];
        currentEnd = start + h.durationMinutes * 60_000;
      }
    }
    if (current.length > 1) groups.push(current);
  }
  return groups.sort((a, b) => a[0].startsAt.getTime() - b[0].startsAt.getTime()).map((g) => g.map(hearingDTO));
}

async function cancelPendingReminders(tx: Tx, organizationId: string, hearingId: string) {
  await tx.reminder.updateMany({ where: { organizationId, hearingId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

export async function createHearing(ctx: Ctx, raw: unknown): Promise<HearingDTO> {
  assertCan(ctx, "hearing:write");
  const input = parse(createBody, raw);
  const tz = ctx.actor.office.timeZone;
  const startsAt = instant(input.date, input.time, tz);
  const created = await prisma.$transaction(async (tx) => {
    const c = await loadAccessibleCase(tx, ctx.actor, input.caseId);
    if (c.status === "CLOSED") throw new AppError("VALIDATION_FAILED", "لا يمكن برمجة جلسة لملف مختوم.");
    await lockLawyerSchedule(tx, ctx.actor.organizationId, c.assignedLawyerId);
    assertNoConflicts(await findConflicts(tx, ctx.actor, { lawyerId: c.assignedLawyerId, startsAt, durationMinutes: input.durationMinutes }), input.acknowledgeConflicts);
    const h = await tx.hearing.create({
      data: {
        organizationId: ctx.actor.organizationId,
        caseId: c.id,
        startsAt,
        timeZone: tz,
        durationMinutes: input.durationMinutes,
        court: input.court,
        chamber: input.chamber ?? null,
        room: input.room ?? null,
        type: input.type,
        notes: input.notes ?? null,
        createdById: ctx.actor.userId,
        updatedById: ctx.actor.userId,
      },
      include: hearingInclude,
    });
    await tx.hearingEvent.create({
      data: { organizationId: ctx.actor.organizationId, hearingId: h.id, kind: "CREATED", actorId: ctx.actor.userId, after: { date: input.date, time: input.time, court: input.court, room: input.room ?? null } },
    });
    await audit(tx, ctx, {
      resourceType: "hearing",
      resourceId: h.id,
      caseId: c.id,
      operation: "hearing.create",
      summary: `برمجة ${input.type} بتاريخ ${input.date} على الساعة ${input.time}`,
      after: { startsAt, durationMinutes: input.durationMinutes, conflictsAcknowledged: input.acknowledgeConflicts },
    });
    return h;
  });
  return hearingDTO(created);
}

export async function updateHearing(ctx: Ctx, hearingId: string, raw: unknown): Promise<HearingDTO> {
  assertCan(ctx, "hearing:write");
  const input = parse(updateBody, raw);
  const tz = ctx.actor.office.timeZone;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.hearing.findFirst({ where: { AND: [{ id: hearingId }, hearingWhere(ctx.actor)] }, include: { case: { select: { assignedLawyerId: true } } } });
    if (!existing) throw notFound("الجلسة");
    if (existing.status !== "SCHEDULED") throw new AppError("CONFLICT", "لا يمكن تعديل جلسة منعقدة أو مؤجلة أو ملغاة.");
    const old = utcToZoned(existing.startsAt, existing.timeZone);
    const date = input.date ?? old.date;
    const time = input.time ?? old.time;
    const startsAt = instant(date, time, tz);
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
    const rescheduled = startsAt.getTime() !== existing.startsAt.getTime() || durationMinutes !== existing.durationMinutes;
    if (rescheduled) {
      await lockLawyerSchedule(tx, ctx.actor.organizationId, existing.case.assignedLawyerId);
      assertNoConflicts(await findConflicts(tx, ctx.actor, { lawyerId: existing.case.assignedLawyerId, startsAt, durationMinutes, excludeId: hearingId }), input.acknowledgeConflicts);
    }
    const data = {
      startsAt,
      timeZone: tz,
      durationMinutes,
      court: input.court ?? existing.court,
      chamber: input.chamber === undefined ? existing.chamber : input.chamber,
      room: input.room === undefined ? existing.room : input.room,
      type: input.type ?? existing.type,
      notes: input.notes === undefined ? existing.notes : input.notes,
    };
    const result = await tx.hearing.updateMany({
      where: { id: hearingId, organizationId: ctx.actor.organizationId, version: input.version },
      data: { ...data, updatedById: ctx.actor.userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    const before = { date: old.date, time: old.time, durationMinutes: existing.durationMinutes, court: existing.court, room: existing.room, type: existing.type };
    const after = { date, time, durationMinutes, court: data.court, room: data.room, type: data.type };
    await tx.hearingEvent.create({
      data: { organizationId: ctx.actor.organizationId, hearingId, kind: rescheduled ? "RESCHEDULED" : "UPDATED", reason: input.reason ?? null, actorId: ctx.actor.userId, before, after },
    });
    if (rescheduled) {
      // Reminders were computed from the old time: they no longer apply.
      await cancelPendingReminders(tx, ctx.actor.organizationId, hearingId);
    }
    await audit(tx, ctx, {
      resourceType: "hearing",
      resourceId: hearingId,
      caseId: existing.caseId,
      operation: rescheduled ? "hearing.reschedule" : "hearing.update",
      summary: rescheduled ? `تغيير موعد جلسة من ${old.date} ${old.time} إلى ${date} ${time}` : "تعديل بيانات جلسة",
      before,
      after,
    });
  });
  return getHearing(ctx, hearingId);
}

export async function changeHearingStatus(ctx: Ctx, hearingId: string, raw: unknown): Promise<{ hearing: HearingDTO; next: HearingDTO | null }> {
  assertCan(ctx, "hearing:write");
  const input = parse(statusBody, raw);
  if (input.status === "CANCELLED") assertCan(ctx, "hearing:cancel");
  const tz = ctx.actor.office.timeZone;
  const nextId = await prisma.$transaction(async (tx) => {
    const existing = await tx.hearing.findFirst({ where: { AND: [{ id: hearingId }, hearingWhere(ctx.actor)] }, include: { case: { select: { assignedLawyerId: true, status: true } } } });
    if (!existing) throw notFound("الجلسة");
    if (existing.status !== "SCHEDULED") throw new AppError("CONFLICT", "تم تحديد مآل هذه الجلسة مسبقاً.");
    const result = await tx.hearing.updateMany({
      where: { id: hearingId, organizationId: ctx.actor.organizationId, version: input.version },
      data: { status: input.status, updatedById: ctx.actor.userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await tx.hearingEvent.create({
      data: {
        organizationId: ctx.actor.organizationId,
        hearingId,
        kind: input.status === "CANCELLED" ? "CANCELLED" : "STATUS_CHANGED",
        reason: input.reason ?? null,
        actorId: ctx.actor.userId,
        before: { status: existing.status },
        after: { status: input.status, ...(input.next ? { next: input.next } : {}) },
      },
    });
    if (input.status !== "HELD") await cancelPendingReminders(tx, ctx.actor.organizationId, hearingId);
    const labels = { HELD: "انعقاد جلسة", POSTPONED: "تأجيل جلسة", CANCELLED: "إلغاء جلسة" } as const;
    await audit(tx, ctx, { resourceType: "hearing", resourceId: hearingId, caseId: existing.caseId, operation: `hearing.${input.status.toLowerCase()}`, summary: labels[input.status], after: { status: input.status } });

    if (input.status !== "POSTPONED" || !input.next) return null;
    const startsAt = instant(input.next.date, input.next.time, tz);
    await lockLawyerSchedule(tx, ctx.actor.organizationId, existing.case.assignedLawyerId);
    assertNoConflicts(await findConflicts(tx, ctx.actor, { lawyerId: existing.case.assignedLawyerId, startsAt, durationMinutes: existing.durationMinutes }), input.acknowledgeConflicts);
    const follow = await tx.hearing.create({
      data: {
        organizationId: ctx.actor.organizationId,
        caseId: existing.caseId,
        startsAt,
        timeZone: tz,
        durationMinutes: existing.durationMinutes,
        court: existing.court,
        chamber: existing.chamber,
        room: existing.room,
        type: existing.type,
        notes: null,
        createdById: ctx.actor.userId,
        updatedById: ctx.actor.userId,
      },
    });
    await tx.hearingEvent.create({
      data: { organizationId: ctx.actor.organizationId, hearingId: follow.id, kind: "CREATED", reason: `تأجيل الجلسة ${hearingId}`, actorId: ctx.actor.userId, after: { ...input.next, postponedFrom: hearingId } },
    });
    await audit(tx, ctx, { resourceType: "hearing", resourceId: follow.id, caseId: existing.caseId, operation: "hearing.create", summary: `جلسة مؤجلة إلى ${input.next.date} على الساعة ${input.next.time}`, after: { postponedFrom: hearingId } });
    return follow.id;
  });
  return { hearing: await getHearing(ctx, hearingId), next: nextId ? await getHearing(ctx, nextId) : null };
}

/** Hearings of the next `days` days (inclusive of today) in the office time zone. */
export async function upcomingHearings(ctx: Ctx, days: number): Promise<HearingDTO[]> {
  const tz = ctx.actor.office.timeZone;
  const today = todayIn(tz);
  const rows = await prisma.hearing.findMany({
    where: {
      AND: [hearingWhere(ctx.actor), { status: "SCHEDULED", startsAt: { gte: dayRange(today, tz).start, lt: dayRange(addDaysToDate(today, days), tz).end } }],
    },
    include: hearingInclude,
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  return rows.map(hearingDTO);
}
