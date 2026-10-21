import { Prisma } from "@prisma/client";
import { z } from "zod";

import { CLIENT_TYPES, type ClientDetailDTO, type ClientDTO, type Paginated } from "../../shared/api.js";
import { prisma } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound, versionConflict } from "../http/errors.js";
import { boolParam, optionalEmail, optionalPhone, optionalText, pageArgs, pagination, parse, requiredText, sortParam, version } from "../http/validation.js";
import { normalizeSearch, searchText } from "../lib/text.js";
import { audit } from "./audit.js";
import { assertCan, caseScope, clientScope } from "./authorization.js";
import { caseSummaryDTO, caseSummaryInclude, clientDTO, clientInclude } from "./dto.js";

export const clientFields = z.object({
  type: z.enum(CLIENT_TYPES, { errorMap: () => ({ message: "يرجى اختيار صفة الحريف" }) }),
  fullName: requiredText(200, "يرجى إدخال اسم الحريف"),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  nationalId: optionalText(40),
  notes: optionalText(2000),
});
export type ClientInput = z.infer<typeof clientFields>;

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  type: z.enum(CLIENT_TYPES).optional(),
  archived: boolParam,
  sort: sortParam(["fullName", "createdAt", "updatedAt"] as const, "fullName:asc"),
});

const clientSearch = (c: Pick<ClientInput, "fullName" | "phone" | "email" | "nationalId">) => searchText(c.fullName, c.phone, c.email, c.nationalId);

export async function listClients(ctx: Ctx, raw: unknown): Promise<Paginated<ClientDTO>> {
  assertCan(ctx, "client:read");
  const q = parse(listQuery, raw);
  const where: Prisma.ClientWhereInput = {
    AND: [
      clientScope(ctx.actor),
      q.type ? { type: q.type } : {},
      q.archived === undefined ? { archivedAt: null } : q.archived ? { archivedAt: { not: null } } : { archivedAt: null },
      q.q ? { searchText: { contains: normalizeSearch(q.q) } } : {},
    ],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.client.count({ where }),
    prisma.client.findMany({ where, include: clientInclude, orderBy: [{ [q.sort.field]: q.sort.dir }, { id: "asc" }], ...pageArgs(q) }),
  ]);
  return { items: rows.map(clientDTO), page: q.page, pageSize: q.pageSize, total };
}

export async function getClient(ctx: Ctx, id: string): Promise<ClientDetailDTO> {
  assertCan(ctx, "client:read");
  const client = await prisma.client.findFirst({ where: { AND: [{ id }, clientScope(ctx.actor)] }, include: clientInclude });
  if (!client) throw notFound("الحريف");
  const cases = await prisma.case.findMany({
    where: { AND: [caseScope(ctx.actor), { clients: { some: { clientId: id } } }] },
    include: caseSummaryInclude(new Date()),
    orderBy: { openedOn: "desc" },
  });
  return { ...clientDTO(client), cases: cases.map(caseSummaryDTO) };
}

export async function createClient(ctx: Ctx, raw: unknown): Promise<ClientDTO> {
  assertCan(ctx, "client:write");
  const input = parse(clientFields, raw);
  return prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        organizationId: ctx.actor.organizationId,
        type: input.type,
        fullName: input.fullName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        nationalId: input.nationalId ?? null,
        notes: input.notes ?? null,
        searchText: clientSearch(input),
        createdById: ctx.actor.userId,
      },
      include: clientInclude,
    });
    await audit(tx, ctx, { resourceType: "client", resourceId: created.id, operation: "client.create", summary: "تسجيل حريف جديد", after: { type: created.type } });
    return clientDTO(created);
  });
}

const updateBody = clientFields.partial().extend({ version });

export async function updateClient(ctx: Ctx, id: string, raw: unknown): Promise<ClientDTO> {
  assertCan(ctx, "client:write");
  const input = parse(updateBody, raw);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findFirst({ where: { AND: [{ id }, clientScope(ctx.actor)] } });
    if (!existing) throw notFound("الحريف");
    const merged = {
      type: input.type ?? existing.type,
      fullName: input.fullName ?? existing.fullName,
      phone: input.phone === undefined ? existing.phone : input.phone,
      email: input.email === undefined ? existing.email : input.email,
      address: input.address === undefined ? existing.address : input.address,
      nationalId: input.nationalId === undefined ? existing.nationalId : input.nationalId,
      notes: input.notes === undefined ? existing.notes : input.notes,
    };
    const result = await tx.client.updateMany({
      where: { id, organizationId: ctx.actor.organizationId, version: input.version },
      data: { ...merged, searchText: clientSearch(merged), version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    const changed = Object.keys(merged).filter((k) => merged[k as keyof typeof merged] !== existing[k as keyof typeof merged]);
    await audit(tx, ctx, { resourceType: "client", resourceId: id, operation: "client.update", summary: "تعديل بيانات حريف", after: { fields: changed } });
    return clientDTO(await tx.client.findUniqueOrThrow({ where: { id }, include: clientInclude }));
  });
}

export async function setClientArchived(ctx: Ctx, id: string, archived: boolean, raw: unknown): Promise<ClientDTO> {
  assertCan(ctx, "client:write");
  const { version: v } = parse(z.object({ version }), raw);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findFirst({ where: { AND: [{ id }, clientScope(ctx.actor)] } });
    if (!existing) throw notFound("الحريف");
    if (!!existing.archivedAt === archived) throw new AppError("CONFLICT", archived ? "الحريف مؤرشف مسبقاً." : "الحريف غير مؤرشف.");
    const result = await tx.client.updateMany({
      where: { id, organizationId: ctx.actor.organizationId, version: v },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    });
    if (result.count === 0) throw versionConflict();
    await audit(tx, ctx, { resourceType: "client", resourceId: id, operation: archived ? "client.archive" : "client.unarchive", summary: archived ? "أرشفة حريف" : "إلغاء أرشفة حريف" });
    return clientDTO(await tx.client.findUniqueOrThrow({ where: { id }, include: clientInclude }));
  });
}
