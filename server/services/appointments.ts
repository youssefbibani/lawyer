/** Client appointments («مواعيد الحرفاء»): meetings with a client at the office. */
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { APPOINTMENT_STATUSES, type AppointmentDTO, type Paginated } from "../../shared/api.js";
import { prisma } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { hhmm, id, isoDate, optionalText, pageArgs, parse, requiredText, version } from "../http/validation.js";
import { dateOnly, formatDateOnly, todayIn } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, clientScope } from "./authorization.js";

const include = { client: { select: { id: true, fullName: true } } } satisfies Prisma.AppointmentInclude;
type Row = Prisma.AppointmentGetPayload<{ include: typeof include }>;

function dto(a: Row): AppointmentDTO {
  return {
    id: a.id,
    client: a.client,
    date: formatDateOnly(a.date),
    time: a.time,
    subject: a.subject,
    notes: a.notes,
    status: a.status,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
  };
}

const fields = z.object({
  clientId: id,
  date: isoDate,
  time: hhmm.nullish(),
  subject: requiredText(200, "يرجى إدخال موضوع الموعد"),
  notes: optionalText(2000),
});

const listQuery = z.object({
  /** "upcoming" (default): scheduled from today on. "past": everything before today or no longer scheduled. */
  when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  clientId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

/** Appointments are visible exactly when their client is. */
const scope = (ctx: Ctx): Prisma.AppointmentWhereInput => ({ organizationId: ctx.actor.organizationId, client: clientScope(ctx.actor) });

export function upcomingAppointmentsWhere(ctx: Ctx): Prisma.AppointmentWhereInput {
  return { AND: [scope(ctx), { status: "SCHEDULED", date: { gte: dateOnly(todayIn(ctx.actor.office.timeZone)) } }] };
}

export async function listAppointments(ctx: Ctx, raw: unknown): Promise<Paginated<AppointmentDTO>> {
  assertCan(ctx, "client:read");
  const q = parse(listQuery, raw);
  const today = dateOnly(todayIn(ctx.actor.office.timeZone));
  const when: Prisma.AppointmentWhereInput =
    q.when === "upcoming"
      ? { status: "SCHEDULED", date: { gte: today } }
      : q.when === "past"
        ? { OR: [{ date: { lt: today } }, { status: { not: "SCHEDULED" } }] }
        : {};
  const where: Prisma.AppointmentWhereInput = { AND: [scope(ctx), when, q.clientId ? { clientId: q.clientId } : {}] };
  const dir = q.when === "upcoming" ? "asc" : "desc";
  const [total, rows] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, include, orderBy: [{ date: dir }, { time: { sort: dir, nulls: "last" } }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(dto), page: q.page, pageSize: q.pageSize, total };
}

export async function createAppointment(ctx: Ctx, raw: unknown): Promise<AppointmentDTO> {
  assertCan(ctx, "client:write");
  const input = parse(fields, raw);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { AND: [{ id: input.clientId, archivedAt: null }, clientScope(ctx.actor)] }, select: { id: true } });
    if (!client) throw notFound("الحريف");
    const created = await tx.appointment.create({
      data: {
        organizationId: ctx.actor.organizationId,
        clientId: input.clientId,
        date: dateOnly(input.date),
        time: input.time ?? null,
        subject: input.subject,
        notes: input.notes ?? null,
        createdById: ctx.actor.userId,
      },
      include,
    });
    await audit(tx, ctx, {
      resourceType: "appointment",
      resourceId: created.id,
      operation: "appointment.create",
      summary: `موعد مع الحريف بتاريخ ${input.date}${input.time ? ` على الساعة ${input.time}` : ""}`,
    });
    return dto(created);
  });
}

const updateBody = fields.partial().extend({ status: z.enum(APPOINTMENT_STATUSES).optional(), version });

export async function updateAppointment(ctx: Ctx, appointmentId: string, raw: unknown): Promise<AppointmentDTO> {
  assertCan(ctx, "client:write");
  const input = parse(updateBody, raw);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.appointment.findFirst({ where: { AND: [{ id: appointmentId }, scope(ctx)] } });
    if (!existing) throw notFound("الموعد");
    if (input.clientId && input.clientId !== existing.clientId) {
      const client = await tx.client.findFirst({ where: { AND: [{ id: input.clientId, archivedAt: null }, clientScope(ctx.actor)] }, select: { id: true } });
      if (!client) throw notFound("الحريف");
    }
    const result = await tx.appointment.updateMany({
      where: { id: appointmentId, organizationId: ctx.actor.organizationId, version: input.version },
      data: {
        clientId: input.clientId ?? existing.clientId,
        date: input.date ? dateOnly(input.date) : existing.date,
        time: input.time === undefined ? existing.time : input.time,
        subject: input.subject ?? existing.subject,
        notes: input.notes === undefined ? existing.notes : input.notes,
        status: input.status ?? existing.status,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw versionConflict();
    const summary =
      input.status && input.status !== existing.status ? (input.status === "DONE" ? "تم الموعد مع الحريف" : input.status === "CANCELLED" ? "إلغاء موعد مع الحريف" : "إعادة برمجة موعد") : "تعديل موعد مع الحريف";
    await audit(tx, ctx, { resourceType: "appointment", resourceId: appointmentId, operation: "appointment.update", summary });
    const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
    if (!updated) throw new AppError("INTERNAL", "تعذّر تحميل الموعد بعد الحفظ.");
    return dto(updated);
  });
}
