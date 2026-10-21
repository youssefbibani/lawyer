import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  CASE_CLIENT_ROLES,
  CASE_STATUSES,
  CASE_TYPES,
  type CaseDetailDTO,
  type CaseNoteDTO,
  type CaseSummaryDTO,
  type Paginated,
  type TimelineEntryDTO,
} from "../../shared/api.js";
import { prisma, type Tx } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { id, isoDate, optionalText, pageArgs, pagination, parse, requiredText, sortParam, version } from "../http/validation.js";
import { normalizeSearch, searchText } from "../lib/text.js";
import { dateOnly, todayIn } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan, can, caseScope, loadAccessibleCase, loadActiveMember } from "./authorization.js";
import { clientFields } from "./clients.js";
import { caseSummaryDTO, caseSummaryInclude, memberRole } from "./dto.js";

const reference = requiredText(60, "يرجى إدخال مرجع القضية").refine((v) => /^[\p{L}\p{N}][\p{L}\p{N} /._-]*$/u.test(v), "مرجع القضية يحتوي على رموز غير مسموح بها");

const createBody = z
  .object({
    reference,
    type: z.enum(CASE_TYPES, { errorMap: () => ({ message: "يرجى اختيار نوع القضية" }) }),
    status: z.enum(CASE_STATUSES).optional(),
    court: requiredText(200, "يرجى إدخال اسم المحكمة"),
    chamber: optionalText(200),
    description: optionalText(5000),
    openedOn: isoDate.optional(),
    assignedLawyerId: id,
    clientIds: z.array(id).max(10).optional(),
    newClient: clientFields.optional(),
    memberIds: z.array(id).max(20).optional(),
  })
  .refine((v) => (v.clientIds?.length ?? 0) > 0 || !!v.newClient, { message: "يرجى اختيار الحريف أو إدخال حريف جديد", path: ["clientIds"] });

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  type: z.enum(CASE_TYPES).optional(),
  lawyerId: id.optional(),
  clientId: id.optional(),
  sort: sortParam(["reference", "openedOn", "updatedAt"] as const, "updatedAt:desc"),
});

const caseSearch = (c: { reference: string; court: string; chamber?: string | null; description?: string | null }) =>
  searchText(c.reference, c.court, c.chamber, c.description);

function duplicateReference(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target ?? "").includes("reference");
}

export async function listCases(ctx: Ctx, raw: unknown): Promise<Paginated<CaseSummaryDTO>> {
  assertCan(ctx, "case:read");
  const q = parse(listQuery, raw);
  const term = q.q ? normalizeSearch(q.q) : "";
  const where: Prisma.CaseWhereInput = {
    AND: [
      caseScope(ctx.actor),
      { archivedAt: null },
      q.status ? { status: q.status } : {},
      q.type ? { type: q.type } : {},
      q.lawyerId ? { assignedLawyerId: q.lawyerId } : {},
      q.clientId ? { clients: { some: { clientId: q.clientId } } } : {},
      term ? { OR: [{ searchText: { contains: term } }, { clients: { some: { client: { searchText: { contains: term } } } } }] } : {},
    ],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.case.count({ where }),
    prisma.case.findMany({ where, include: caseSummaryInclude(new Date()), orderBy: [{ [q.sort.field]: q.sort.dir }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(caseSummaryDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getCase(ctx: Ctx, caseId: string): Promise<CaseDetailDTO> {
  assertCan(ctx, "case:read");
  const row = await prisma.case.findFirst({
    where: { AND: [{ id: caseId }, caseScope(ctx.actor)] },
    include: {
      ...caseSummaryInclude(new Date()),
      members: { include: { member: { select: { userId: true, role: true, user: { select: { name: true } } } } } },
    },
  });
  if (!row) throw notFound("الملف");
  return {
    ...caseSummaryDTO(row),
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    members: row.members.map((m) => ({ userId: m.member.userId, name: m.member.user.name, role: memberRole(m.member.role) })),
    can: {
      update: can(ctx.actor, "case:update"),
      changeStatus: can(ctx.actor, "case:status"),
      assign: can(ctx.actor, "case:assign"),
      addNote: can(ctx.actor, "note:write"),
      scheduleHearing: can(ctx.actor, "hearing:write"),
      finance: can(ctx.actor, "finance:read"),
    },
  };
}

async function staffIds(tx: Tx, ctx: Ctx, requested: string[] | undefined): Promise<string[]> {
  const ids = new Set(requested ?? []);
  if (ctx.actor.role === "clerk") ids.add(ctx.actor.userId);
  for (const userId of ids) await loadActiveMember(tx, ctx.actor, userId);
  return [...ids];
}

export async function createCase(ctx: Ctx, raw: unknown): Promise<CaseDetailDTO> {
  assertCan(ctx, "case:create");
  const input = parse(createBody, raw);
  if (input.status && input.status !== "ACTIVE") assertCan(ctx, "case:status");
  if (input.memberIds?.some((m) => m !== ctx.actor.userId)) assertCan(ctx, "case:assign");
  const openedOn = input.openedOn ?? todayIn(ctx.actor.office.timeZone);

  let caseId: string;
  try {
    caseId = await prisma.$transaction(async (tx) => {
      await loadActiveMember(tx, ctx.actor, input.assignedLawyerId, ["lawyer", "admin"]);
      const exists = await tx.case.findUnique({ where: { organizationId_reference: { organizationId: ctx.actor.organizationId, reference: input.reference } }, select: { id: true } });
      if (exists) throw new AppError("CONFLICT", "يوجد ملف مسجّل بنفس المرجع في مكتبك.");

      const clientIds = [...new Set(input.clientIds ?? [])];
      if (clientIds.length) {
        // Clients must belong to this office (the composite FK enforces it too).
        const found = await tx.client.count({ where: { id: { in: clientIds }, organizationId: ctx.actor.organizationId, archivedAt: null } });
        if (found !== clientIds.length) throw new AppError("VALIDATION_FAILED", "أحد الحرفاء المحددين غير موجود ضمن مكتبك.");
      }
      if (input.newClient) {
        assertCan(ctx, "client:write");
        const c = input.newClient;
        const client = await tx.client.create({
          data: {
            organizationId: ctx.actor.organizationId,
            type: c.type,
            fullName: c.fullName,
            phone: c.phone ?? null,
            email: c.email ?? null,
            address: c.address ?? null,
            nationalId: c.nationalId ?? null,
            notes: c.notes ?? null,
            searchText: searchText(c.fullName, c.phone, c.email, c.nationalId),
            createdById: ctx.actor.userId,
          },
        });
        clientIds.unshift(client.id);
        await audit(tx, ctx, { resourceType: "client", resourceId: client.id, operation: "client.create", summary: "تسجيل حريف جديد عند فتح ملف" });
      }
      const members = await staffIds(tx, ctx, input.memberIds);

      const created = await tx.case.create({
        data: {
          organizationId: ctx.actor.organizationId,
          reference: input.reference,
          type: input.type,
          status: input.status ?? "ACTIVE",
          court: input.court,
          chamber: input.chamber ?? null,
          description: input.description ?? null,
          openedOn: dateOnly(openedOn),
          closedOn: input.status === "CLOSED" ? dateOnly(todayIn(ctx.actor.office.timeZone)) : null,
          assignedLawyerId: input.assignedLawyerId,
          searchText: caseSearch(input),
          createdById: ctx.actor.userId,
          clients: { create: clientIds.map((clientId, i) => ({ clientId, role: i === 0 ? "PRINCIPAL" : "CO_CLIENT" })) },
          members: { create: members.map((userId) => ({ userId })) },
        },
      });
      await audit(tx, ctx, {
        resourceType: "case",
        resourceId: created.id,
        caseId: created.id,
        operation: "case.create",
        summary: `فتح الملف ${created.reference}`,
        after: { reference: created.reference, type: created.type, status: created.status, assignedLawyerId: created.assignedLawyerId },
      });
      return created.id;
    });
  } catch (err) {
    if (duplicateReference(err)) throw new AppError("CONFLICT", "يوجد ملف مسجّل بنفس المرجع في مكتبك.");
    throw err;
  }
  return getCase(ctx, caseId);
}

const updateBody = z.object({
  reference: reference.optional(),
  type: z.enum(CASE_TYPES).optional(),
  court: requiredText(200, "يرجى إدخال اسم المحكمة").optional(),
  chamber: optionalText(200),
  description: optionalText(5000),
  version,
});

/** Runs a versioned update on an accessible case, then audits it. */
async function versionedCaseUpdate(
  ctx: Ctx,
  caseId: string,
  expectedVersion: number,
  build: (existing: Prisma.CaseGetPayload<object>, tx: Tx) => Promise<{ data: Prisma.CaseUncheckedUpdateManyInput; operation: string; summary: string; before?: unknown; after?: unknown }>,
): Promise<CaseDetailDTO> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.case.findFirst({ where: { AND: [{ id: caseId }, caseScope(ctx.actor)] } });
      if (!existing) throw notFound("الملف");
      const change = await build(existing, tx);
      const result = await tx.case.updateMany({
        where: { id: caseId, organizationId: ctx.actor.organizationId, version: expectedVersion },
        data: { ...change.data, version: { increment: 1 } },
      });
      if (result.count === 0) throw versionConflict();
      await audit(tx, ctx, { resourceType: "case", resourceId: caseId, caseId, operation: change.operation, summary: change.summary, before: change.before, after: change.after });
    });
  } catch (err) {
    if (duplicateReference(err)) throw new AppError("CONFLICT", "يوجد ملف مسجّل بنفس المرجع في مكتبك.");
    throw err;
  }
  return getCase(ctx, caseId);
}

export async function updateCase(ctx: Ctx, caseId: string, raw: unknown) {
  assertCan(ctx, "case:update");
  const input = parse(updateBody, raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing) => {
    const merged = {
      reference: input.reference ?? existing.reference,
      type: input.type ?? existing.type,
      court: input.court ?? existing.court,
      chamber: input.chamber === undefined ? existing.chamber : input.chamber,
      description: input.description === undefined ? existing.description : input.description,
    };
    const fields = Object.keys(merged).filter((k) => merged[k as keyof typeof merged] !== existing[k as keyof typeof merged]);
    return {
      data: { ...merged, searchText: caseSearch(merged) },
      operation: "case.update",
      summary: `تعديل بيانات الملف ${merged.reference}`,
      before: { reference: existing.reference, type: existing.type, court: existing.court },
      after: { fields },
    };
  });
}

export async function changeCaseStatus(ctx: Ctx, caseId: string, raw: unknown) {
  assertCan(ctx, "case:status");
  const input = parse(z.object({ status: z.enum(CASE_STATUSES, { errorMap: () => ({ message: "حالة غير صالحة" }) }), closedOn: isoDate.optional(), version }), raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing) => {
    if (existing.status === input.status) throw new AppError("CONFLICT", "الملف في هذه الحالة مسبقاً.");
    const closedOn = input.status === "CLOSED" ? dateOnly(input.closedOn ?? todayIn(ctx.actor.office.timeZone)) : null;
    if (closedOn && closedOn < existing.openedOn) throw new AppError("VALIDATION_FAILED", "تاريخ الختم لا يمكن أن يسبق تاريخ فتح الملف.");
    return {
      data: { status: input.status, closedOn },
      operation: "case.status",
      summary: `تغيير حالة الملف ${existing.reference}`,
      before: { status: existing.status },
      after: { status: input.status },
    };
  });
}

export async function assignCaseLawyer(ctx: Ctx, caseId: string, raw: unknown) {
  assertCan(ctx, "case:assign");
  const input = parse(z.object({ assignedLawyerId: id, version }), raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing, tx) => {
    await loadActiveMember(tx, ctx.actor, input.assignedLawyerId, ["lawyer", "admin"]);
    if (existing.assignedLawyerId === input.assignedLawyerId) throw new AppError("CONFLICT", "هذا المحامي مكلّف بالملف مسبقاً.");
    return {
      data: { assignedLawyerId: input.assignedLawyerId },
      operation: "case.assign",
      summary: `تغيير المحامي المكلّف بالملف ${existing.reference}`,
      before: { assignedLawyerId: existing.assignedLawyerId },
      after: { assignedLawyerId: input.assignedLawyerId },
    };
  });
}

export async function setCaseMembers(ctx: Ctx, caseId: string, raw: unknown) {
  assertCan(ctx, "case:assign");
  const input = parse(z.object({ userIds: z.array(id).max(20), version }), raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing, tx) => {
    const userIds = [...new Set(input.userIds)];
    for (const userId of userIds) await loadActiveMember(tx, ctx.actor, userId);
    const before = await tx.caseMember.findMany({ where: { caseId }, select: { userId: true } });
    await tx.caseMember.deleteMany({ where: { caseId, organizationId: ctx.actor.organizationId, userId: { notIn: userIds } } });
    await tx.caseMember.createMany({ data: userIds.map((userId) => ({ caseId, userId, organizationId: ctx.actor.organizationId })), skipDuplicates: true });
    return {
      data: {},
      operation: "case.members",
      summary: `تحديث فريق الملف ${existing.reference}`,
      before: { userIds: before.map((b) => b.userId) },
      after: { userIds },
    };
  });
}

export async function addCaseClient(ctx: Ctx, caseId: string, raw: unknown) {
  assertCan(ctx, "case:update");
  const input = parse(z.object({ clientId: id, role: z.enum(CASE_CLIENT_ROLES).default("CO_CLIENT"), version }), raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing, tx) => {
    const client = await tx.client.findFirst({ where: { id: input.clientId, organizationId: ctx.actor.organizationId, archivedAt: null } });
    if (!client) throw notFound("الحريف");
    const linked = await tx.caseClient.findUnique({ where: { caseId_clientId: { caseId, clientId: input.clientId } } });
    if (linked) throw new AppError("CONFLICT", "الحريف مرتبط بهذا الملف مسبقاً.");
    await tx.caseClient.create({ data: { caseId, clientId: input.clientId, organizationId: ctx.actor.organizationId, role: input.role } });
    return { data: {}, operation: "case.client.add", summary: `ربط حريف بالملف ${existing.reference}`, after: { clientId: input.clientId, role: input.role } };
  });
}

export async function removeCaseClient(ctx: Ctx, caseId: string, clientId: string, raw: unknown) {
  assertCan(ctx, "case:update");
  const input = parse(z.object({ version }), raw);
  return versionedCaseUpdate(ctx, caseId, input.version, async (existing, tx) => {
    const links = await tx.caseClient.findMany({ where: { caseId } });
    if (!links.some((l) => l.clientId === clientId)) throw notFound("الحريف");
    if (links.length === 1) throw new AppError("VALIDATION_FAILED", "يجب أن يبقى للملف حريف واحد على الأقل.");
    await tx.caseClient.delete({ where: { caseId_clientId: { caseId, clientId } } });
    return { data: {}, operation: "case.client.remove", summary: `فك ربط حريف بالملف ${existing.reference}`, before: { clientId } };
  });
}

// ——— Notes ———

export async function listNotes(ctx: Ctx, caseId: string): Promise<CaseNoteDTO[]> {
  assertCan(ctx, "case:read");
  await loadAccessibleCase(prisma, ctx.actor, caseId);
  const notes = await prisma.caseNote.findMany({ where: { caseId, organizationId: ctx.actor.organizationId }, include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return notes.map((n) => ({ id: n.id, content: n.content, author: { userId: n.author.id, name: n.author.name }, createdAt: n.createdAt.toISOString() }));
}

export async function addNote(ctx: Ctx, caseId: string, raw: unknown): Promise<CaseNoteDTO> {
  assertCan(ctx, "note:write");
  const input = parse(z.object({ content: requiredText(5000, "يرجى إدخال نص الملاحظة") }), raw);
  return prisma.$transaction(async (tx) => {
    const c = await loadAccessibleCase(tx, ctx.actor, caseId);
    const note = await tx.caseNote.create({
      data: { caseId, organizationId: ctx.actor.organizationId, authorId: ctx.actor.userId, content: input.content },
      include: { author: { select: { id: true, name: true } } },
    });
    // The note text itself is confidential: the audit entry records the action only.
    await audit(tx, ctx, { resourceType: "note", resourceId: note.id, caseId, operation: "note.create", summary: `إضافة ملاحظة إلى الملف ${c.reference}` });
    return { id: note.id, content: note.content, author: { userId: note.author.id, name: note.author.name }, createdAt: note.createdAt.toISOString() };
  });
}

// ——— Timeline (from the audit log) ———

export async function caseTimeline(ctx: Ctx, caseId: string): Promise<TimelineEntryDTO[]> {
  assertCan(ctx, "case:read");
  await loadAccessibleCase(prisma, ctx.actor, caseId);
  const finance = can(ctx.actor, "finance:read");
  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId: ctx.actor.organizationId,
      caseId,
      outcome: "SUCCESS",
      ...(finance ? {} : { resourceType: { notIn: ["fee_agreement", "payment", "receipt"] } }),
    },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    operation: r.operation,
    resourceType: r.resourceType,
    summary: r.summary ?? r.operation,
    actor: r.actor ? { userId: r.actor.id, name: r.actor.name } : null,
  }));
}
