import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  type CompleteTaskResultDTO,
  type Paginated,
  type TaskBucket,
  type TaskConflictsDTO,
  type TaskDTO,
  type TaskRecurrence,
} from "../../shared/api.js";
import { prisma, type Tx } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { hhmm, id, isoDate, optionalText, pageArgs, parse, requiredText, version } from "../http/validation.js";
import { addDaysToDate, addMonthsToDate, dateOnly, formatDateOnly, todayIn, zonedToUtc } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, caseScope, loadAccessibleCase, loadActiveMember, taskScope } from "./authorization.js";
import { hearingDTO, hearingInclude, taskDTO, taskInclude } from "./dto.js";

const fields = {
  title: requiredText(300, "يرجى إدخال عنوان المهمة"),
  description: optionalText(3000),
  caseId: id.nullish(),
  hearingId: id.nullish(),
  assigneeId: id,
  dueDate: isoDate.nullish(),
  dueTime: hhmm.nullish(),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  recurrence: z.enum(TASK_RECURRENCES).default("NONE"),
  notifyInApp: z.boolean().default(true),
  notifyEmail: z.boolean().default(false),
};

const createBody = z
  .object({ kind: z.enum(["TASK", "REMINDER"]).default("TASK"), ...fields, acknowledgeConflicts: z.boolean().default(false) })
  .refine((v) => !v.dueTime || !!v.dueDate, { message: "حدّد التاريخ قبل الساعة", path: ["dueTime"] })
  .refine((v) => v.recurrence === "NONE" || !!v.dueDate, { message: "التكرار يتطلب تاريخ إنجاز", path: ["recurrence"] });

const updateBody = z
  .object({
    kind: z.enum(["TASK", "REMINDER"]).optional(),
    title: fields.title.optional(),
    description: fields.description,
    caseId: fields.caseId,
    hearingId: fields.hearingId,
    assigneeId: id.optional(),
    dueDate: fields.dueDate,
    dueTime: fields.dueTime,
    priority: z.enum(TASK_PRIORITIES).optional(),
    recurrence: z.enum(TASK_RECURRENCES).optional(),
    notifyInApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    acknowledgeConflicts: z.boolean().default(false),
    version,
  });

const listQuery = z.object({
  bucket: z.enum(["today", "upcoming", "overdue", "done"]).optional(),
  assigneeId: z.union([z.literal("me"), id]).optional(),
  caseId: id.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

const conflictQuery = z.object({ assigneeId: id, dueDate: isoDate, dueTime: hhmm, excludeId: id.optional() });

const HOUR = 60 * 60_000;

function dueInstant(dueDate: string | null | undefined, dueTime: string | null | undefined, tz: string): Date | null {
  if (!dueDate || !dueTime) return null;
  const at = zonedToUtc(dueDate, dueTime, tz);
  if (!at) throw new AppError("VALIDATION_FAILED", "هذا التوقيت غير موجود في المنطقة الزمنية للمكتب.");
  return at;
}

function bucketWhere(bucket: TaskBucket | undefined, today: string): Prisma.TaskWhereInput {
  const day = dateOnly(today);
  switch (bucket) {
    case "done":
      return { status: "DONE" };
    case "overdue":
      return { status: "OPEN", dueDate: { lt: day } };
    case "today":
      return { status: "OPEN", dueDate: day };
    case "upcoming":
      return { status: "OPEN", OR: [{ dueDate: { gt: day } }, { dueDate: null }] };
    default:
      return { status: { in: ["OPEN", "DONE"] } };
  }
}

export async function listTasks(ctx: Ctx, raw: unknown): Promise<Paginated<TaskDTO>> {
  const q = parse(listQuery, raw);
  const today = todayIn(ctx.actor.office.timeZone);
  const assigneeId = q.assigneeId === "me" ? ctx.actor.userId : q.assigneeId;
  const where: Prisma.TaskWhereInput = {
    AND: [
      taskScope(ctx.actor),
      bucketWhere(q.bucket, today),
      assigneeId ? { assigneeId } : {},
      q.caseId ? { caseId: q.caseId } : {},
      q.q ? { title: { contains: q.q, mode: "insensitive" } } : {},
    ],
  };
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    q.bucket === "done" ? [{ completedAt: "desc" }] : [{ dueDate: { sort: "asc", nulls: "last" } }, { dueTime: { sort: "asc", nulls: "last" } }, { priority: "asc" }, { createdAt: "asc" }];
  const [total, rows] = await prisma.$transaction([
    prisma.task.count({ where }),
    prisma.task.findMany({ where, include: taskInclude, orderBy, ...pageArgs(q) }),
  ]);
  return { items: rows.map(taskDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function taskSummary(ctx: Ctx, raw: unknown): Promise<Record<TaskBucket, number>> {
  const q = parse(listQuery.pick({ assigneeId: true, caseId: true }), raw);
  const today = todayIn(ctx.actor.office.timeZone);
  const assigneeId = q.assigneeId === "me" ? ctx.actor.userId : q.assigneeId;
  const base: Prisma.TaskWhereInput[] = [taskScope(ctx.actor), assigneeId ? { assigneeId } : {}, q.caseId ? { caseId: q.caseId } : {}];
  const buckets: TaskBucket[] = ["today", "upcoming", "overdue", "done"];
  const counts = await prisma.$transaction(buckets.map((b) => prisma.task.count({ where: { AND: [...base, bucketWhere(b, today)] } })));
  return Object.fromEntries(buckets.map((b, i) => [b, counts[i]])) as Record<TaskBucket, number>;
}

export async function getTask(ctx: Ctx, taskId: string): Promise<TaskDTO> {
  const t = await prisma.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(ctx.actor)] }, include: taskInclude });
  if (!t) throw notFound("المهمة");
  return taskDTO(t);
}

/** Open tasks of the same assignee within an hour, and that person's hearings around the same time. */
async function findTaskConflicts(tx: Tx, ctx: Ctx, args: { assigneeId: string; dueAt: Date; excludeId?: string }): Promise<TaskConflictsDTO> {
  const t = args.dueAt.getTime();
  const [tasks, hearings] = await Promise.all([
    tx.task.findMany({
      where: {
        AND: [
          taskScope(ctx.actor),
          { status: "OPEN", assigneeId: args.assigneeId, dueAt: { gt: new Date(t - HOUR), lt: new Date(t + HOUR) } },
          args.excludeId ? { id: { not: args.excludeId } } : {},
        ],
      },
      include: taskInclude,
    }),
    tx.hearing.findMany({
      where: {
        organizationId: ctx.actor.organizationId,
        status: "SCHEDULED",
        startsAt: { gt: new Date(t - 24 * HOUR), lt: new Date(t + HOUR) },
        case: { AND: [caseScope(ctx.actor), { OR: [{ assignedLawyerId: args.assigneeId }, { members: { some: { userId: args.assigneeId } } }] }] },
      },
      include: hearingInclude,
    }),
  ]);
  return {
    tasks: tasks.map(taskDTO),
    hearings: hearings.filter((h) => h.startsAt.getTime() + h.durationMinutes * 60_000 > t).map(hearingDTO),
  };
}

export async function previewTaskConflicts(ctx: Ctx, raw: unknown): Promise<TaskConflictsDTO> {
  const q = parse(conflictQuery, raw);
  const dueAt = dueInstant(q.dueDate, q.dueTime, ctx.actor.office.timeZone)!;
  return findTaskConflicts(prisma, ctx, { assigneeId: q.assigneeId, dueAt, excludeId: q.excludeId });
}

/** Re-derives the task's pending reminder rows from its due instant and requested channels. */
export async function syncTaskReminders(tx: Tx, ctx: Ctx, taskId: string) {
  const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
  await tx.reminder.updateMany({ where: { taskId, organizationId: task.organizationId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (task.status !== "OPEN" || !task.dueAt) return;
  const channels = [task.notifyInApp ? ("IN_APP" as const) : null, task.notifyEmail ? ("EMAIL" as const) : null].filter((c) => c !== null);
  if (!channels.length) return;
  await tx.reminder.createMany({
    data: channels.map((channel) => ({
      organizationId: task.organizationId,
      taskId,
      recipientId: task.assigneeId,
      scheduledAt: task.dueAt!,
      channel,
      createdById: ctx.actor.userId,
    })),
  });
}

async function resolveLinks(tx: Tx, ctx: Ctx, caseId: string | null | undefined, hearingId: string | null | undefined) {
  let resolvedCase = caseId ?? null;
  if (hearingId) {
    const h = await tx.hearing.findFirst({ where: { id: hearingId, organizationId: ctx.actor.organizationId, case: caseScope(ctx.actor) }, select: { caseId: true } });
    if (!h) throw notFound("الجلسة");
    if (resolvedCase && resolvedCase !== h.caseId) throw new AppError("VALIDATION_FAILED", "الجلسة المحددة لا تخص الملف المحدد.");
    resolvedCase = h.caseId;
  }
  if (resolvedCase) await loadAccessibleCase(tx, ctx.actor, resolvedCase);
  return { caseId: resolvedCase, hearingId: hearingId ?? null };
}

function assertNoConflicts(conflicts: TaskConflictsDTO, acknowledged: boolean) {
  if (!acknowledged && conflicts.tasks.length + conflicts.hearings.length > 0) {
    throw new AppError("TASK_CONFLICT", "يوجد تعارض في التوقيت مع مهمة أو جلسة أخرى. أكّد الحفظ رغم التعارض أو غيّر الموعد.", { data: conflicts });
  }
}

export async function createTask(ctx: Ctx, raw: unknown): Promise<TaskDTO> {
  assertCan(ctx, "task:write");
  const input = parse(createBody, raw);
  const tz = ctx.actor.office.timeZone;
  const dueAt = dueInstant(input.dueDate, input.dueTime, tz);
  const taskId = await prisma.$transaction(async (tx) => {
    await loadActiveMember(tx, ctx.actor, input.assigneeId);
    const links = await resolveLinks(tx, ctx, input.caseId, input.hearingId);
    if (dueAt) assertNoConflicts(await findTaskConflicts(tx, ctx, { assigneeId: input.assigneeId, dueAt }), input.acknowledgeConflicts);
    const task = await tx.task.create({
      data: {
        organizationId: ctx.actor.organizationId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        caseId: links.caseId,
        hearingId: links.hearingId,
        assigneeId: input.assigneeId,
        dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
        dueTime: input.dueTime ?? null,
        dueAt,
        priority: input.priority,
        recurrence: input.recurrence,
        notifyInApp: input.notifyInApp,
        notifyEmail: input.notifyEmail,
        createdById: ctx.actor.userId,
      },
    });
    await syncTaskReminders(tx, ctx, task.id);
    await audit(tx, ctx, {
      resourceType: "task",
      resourceId: task.id,
      caseId: links.caseId,
      operation: input.kind === "REMINDER" ? "reminder.create" : "task.create",
      summary: input.kind === "REMINDER" ? "إنشاء تذكير" : "إنشاء مهمة",
      after: { assigneeId: input.assigneeId, dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null },
    });
    return task.id;
  });
  return getTask(ctx, taskId);
}

async function loadOpenTask(tx: Tx, ctx: Ctx, taskId: string) {
  const t = await tx.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(ctx.actor)] } });
  if (!t) throw notFound("المهمة");
  return t;
}

export async function updateTask(ctx: Ctx, taskId: string, raw: unknown): Promise<TaskDTO> {
  assertCan(ctx, "task:write");
  const input = parse(updateBody, raw);
  const tz = ctx.actor.office.timeZone;
  await prisma.$transaction(async (tx) => {
    const t = await loadOpenTask(tx, ctx, taskId);
    if (t.status !== "OPEN") throw new AppError("CONFLICT", "لا يمكن تعديل مهمة منجزة أو ملغاة. أعد فتحها أولاً.");
    const next = {
      kind: input.kind ?? t.kind,
      title: input.title ?? t.title,
      description: input.description === undefined ? t.description : input.description,
      assigneeId: input.assigneeId ?? t.assigneeId,
      dueDate: input.dueDate === undefined ? (t.dueDate ? formatDateOnly(t.dueDate) : null) : input.dueDate,
      dueTime: input.dueTime === undefined ? t.dueTime : input.dueTime,
      priority: input.priority ?? t.priority,
      recurrence: input.recurrence ?? t.recurrence,
      notifyInApp: input.notifyInApp ?? t.notifyInApp,
      notifyEmail: input.notifyEmail ?? t.notifyEmail,
    };
    if (next.dueTime && !next.dueDate) throw new AppError("VALIDATION_FAILED", "حدّد التاريخ قبل الساعة");
    if (next.recurrence !== "NONE" && !next.dueDate) throw new AppError("VALIDATION_FAILED", "التكرار يتطلب تاريخ إنجاز");
    if (next.assigneeId !== t.assigneeId) await loadActiveMember(tx, ctx.actor, next.assigneeId);
    const links =
      input.caseId === undefined && input.hearingId === undefined
        ? { caseId: t.caseId, hearingId: t.hearingId }
        : await resolveLinks(tx, ctx, input.caseId === undefined ? t.caseId : input.caseId, input.hearingId === undefined ? t.hearingId : input.hearingId);
    const dueAt = dueInstant(next.dueDate, next.dueTime, tz);
    const rescheduled = (dueAt?.getTime() ?? null) !== (t.dueAt?.getTime() ?? null) || next.assigneeId !== t.assigneeId;
    if (dueAt && rescheduled) assertNoConflicts(await findTaskConflicts(tx, ctx, { assigneeId: next.assigneeId, dueAt, excludeId: taskId }), input.acknowledgeConflicts);
    const result = await tx.task.updateMany({
      where: { id: taskId, organizationId: ctx.actor.organizationId, version: input.version },
      data: { ...next, ...links, dueDate: next.dueDate ? dateOnly(next.dueDate) : null, dueAt, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await syncTaskReminders(tx, ctx, taskId);
    await audit(tx, ctx, { resourceType: "task", resourceId: taskId, caseId: links.caseId, operation: "task.update", summary: "تعديل مهمة", after: { rescheduled } });
  });
  return getTask(ctx, taskId);
}

function nextDueDate(dueDate: string, recurrence: TaskRecurrence): string {
  if (recurrence === "DAILY") return addDaysToDate(dueDate, 1);
  if (recurrence === "WEEKLY") return addDaysToDate(dueDate, 7);
  return addMonthsToDate(dueDate, 1);
}

export async function completeTask(ctx: Ctx, taskId: string, raw: unknown): Promise<CompleteTaskResultDTO> {
  assertCan(ctx, "task:write");
  const input = parse(z.object({ version }), raw);
  const tz = ctx.actor.office.timeZone;
  const nextId = await prisma.$transaction(async (tx) => {
    const t = await loadOpenTask(tx, ctx, taskId);
    if (t.status !== "OPEN") throw new AppError("CONFLICT", t.status === "DONE" ? "المهمة منجزة مسبقاً." : "المهمة ملغاة.");
    const result = await tx.task.updateMany({
      where: { id: taskId, organizationId: ctx.actor.organizationId, version: input.version, status: "OPEN" },
      data: { status: "DONE", completedAt: new Date(), completedById: ctx.actor.userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await syncTaskReminders(tx, ctx, taskId);
    await audit(tx, ctx, { resourceType: "task", resourceId: taskId, caseId: t.caseId, operation: "task.complete", summary: `إنجاز مهمة: ${t.title.slice(0, 80)}` });

    if (t.recurrence === "NONE" || !t.dueDate) return null;
    const already = await tx.task.findUnique({ where: { spawnedFromId: taskId }, select: { id: true } });
    if (already) return already.id;
    const dueDate = nextDueDate(formatDateOnly(t.dueDate), t.recurrence);
    const next = await tx.task.create({
      data: {
        organizationId: t.organizationId,
        kind: t.kind,
        title: t.title,
        description: t.description,
        caseId: t.caseId,
        hearingId: null,
        assigneeId: t.assigneeId,
        dueDate: dateOnly(dueDate),
        dueTime: t.dueTime,
        dueAt: dueInstant(dueDate, t.dueTime, tz),
        priority: t.priority,
        recurrence: t.recurrence,
        spawnedFromId: taskId,
        notifyInApp: t.notifyInApp,
        notifyEmail: t.notifyEmail,
        createdById: ctx.actor.userId,
      },
    });
    await syncTaskReminders(tx, ctx, next.id);
    await audit(tx, ctx, { resourceType: "task", resourceId: next.id, caseId: t.caseId, operation: "task.recur", summary: `إنشاء الموعد التالي لمهمة متكررة (${dueDate})` });
    return next.id;
  });
  return { task: await getTask(ctx, taskId), next: nextId ? await getTask(ctx, nextId) : null };
}

export async function reopenTask(ctx: Ctx, taskId: string, raw: unknown): Promise<TaskDTO> {
  assertCan(ctx, "task:write");
  const input = parse(z.object({ version }), raw);
  await prisma.$transaction(async (tx) => {
    const t = await loadOpenTask(tx, ctx, taskId);
    if (t.status !== "DONE") throw new AppError("CONFLICT", "يمكن إعادة فتح المهام المنجزة فقط.");
    const result = await tx.task.updateMany({
      where: { id: taskId, organizationId: ctx.actor.organizationId, version: input.version, status: "DONE" },
      data: { status: "OPEN", completedAt: null, completedById: null, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await syncTaskReminders(tx, ctx, taskId);
    await audit(tx, ctx, { resourceType: "task", resourceId: taskId, caseId: t.caseId, operation: "task.reopen", summary: "إعادة فتح مهمة" });
  });
  return getTask(ctx, taskId);
}

/** Non-destructive removal: the task leaves every list but stays in the audit history. */
export async function cancelTask(ctx: Ctx, taskId: string, raw: unknown): Promise<TaskDTO> {
  assertCan(ctx, "task:write");
  const input = parse(z.object({ version }), raw);
  await prisma.$transaction(async (tx) => {
    const t = await loadOpenTask(tx, ctx, taskId);
    if (t.status === "CANCELLED") throw new AppError("CONFLICT", "المهمة ملغاة مسبقاً.");
    const result = await tx.task.updateMany({
      where: { id: taskId, organizationId: ctx.actor.organizationId, version: input.version },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.actor.userId, completedAt: null, completedById: null, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await syncTaskReminders(tx, ctx, taskId);
    await audit(tx, ctx, { resourceType: "task", resourceId: taskId, caseId: t.caseId, operation: "task.cancel", summary: "حذف (إلغاء) مهمة" });
  });
  return getTask(ctx, taskId);
}

