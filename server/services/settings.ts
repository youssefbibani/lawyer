import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { ROLES, type AuditEntryDTO, type MemberDTO, type NotificationPreferenceDTO, type OfficeSettingsDTO, type Paginated, type ProfileDTO, type Role, type SettingsDTO } from "../../shared/api.js";
import { auth, PASSWORD_MIN_LENGTH } from "../auth.js";
import { prisma, type Tx } from "../db.js";
import type { Ctx } from "../http/context.js";
import { AppError, notFound } from "../http/errors.js";
import { currency, id, isoDate, optionalEmail, optionalPhone, optionalText, pageArgs, pagination, parse, requiredText, timeZone } from "../http/validation.js";
import { dayRange } from "../lib/time.js";
import { audit } from "./audit.js";
import { assertCan } from "./authorization.js";

// ——— Office ———

const officeBody = z.object({
  legalName: requiredText(200, "يرجى إدخال اسم المكتب").optional(),
  email: optionalEmail,
  phone: optionalPhone,
  address: optionalText(300),
  city: optionalText(100),
  taxId: optionalText(40),
  barRegistration: optionalText(40),
  timeZone: timeZone.optional(),
  defaultCurrency: currency.optional(),
  lawyersSeeAllCases: z.boolean().optional(),
  clerksSeeAllCases: z.boolean().optional(),
  clerksCanRecordPayments: z.boolean().optional(),
});

function officeDTO(s: Prisma.OfficeSettingsGetPayload<object>): OfficeSettingsDTO {
  return {
    legalName: s.legalName,
    email: s.email,
    phone: s.phone,
    address: s.address,
    city: s.city,
    taxId: s.taxId,
    barRegistration: s.barRegistration,
    timeZone: s.timeZone,
    defaultCurrency: s.defaultCurrency,
    lawyersSeeAllCases: s.lawyersSeeAllCases,
    clerksSeeAllCases: s.clerksSeeAllCases,
    clerksCanRecordPayments: s.clerksCanRecordPayments,
  };
}

async function preferences(db: Tx, ctx: Ctx): Promise<NotificationPreferenceDTO> {
  const p = await db.notificationPreference.upsert({
    where: { organizationId_userId: { organizationId: ctx.actor.organizationId, userId: ctx.actor.userId } },
    update: {},
    create: { organizationId: ctx.actor.organizationId, userId: ctx.actor.userId },
  });
  return { hearingReminders: p.hearingReminders, taskReminders: p.taskReminders, scheduleConflicts: p.scheduleConflicts, emailEnabled: p.emailEnabled, defaultReminderMinutes: p.defaultReminderMinutes };
}

async function profile(ctx: Ctx): Promise<ProfileDTO> {
  const m = await prisma.member.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: ctx.actor.organizationId, userId: ctx.actor.userId } },
    include: { user: { select: { name: true, email: true } } },
  });
  return { name: m.user.name, email: m.user.email, phone: m.phone, barNumber: m.barNumber };
}

export async function getSettings(ctx: Ctx): Promise<SettingsDTO> {
  const office = await prisma.officeSettings.findUniqueOrThrow({ where: { organizationId: ctx.actor.organizationId } });
  return { office: officeDTO(office), preferences: await preferences(prisma, ctx), profile: await profile(ctx) };
}

export async function updateOffice(ctx: Ctx, raw: unknown): Promise<OfficeSettingsDTO> {
  assertCan(ctx, "settings:office");
  const input = parse(officeBody, raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.officeSettings.findUniqueOrThrow({ where: { organizationId: ctx.actor.organizationId } });
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Prisma.OfficeSettingsUpdateInput;
    const after = await tx.officeSettings.update({ where: { organizationId: ctx.actor.organizationId }, data });
    if (input.legalName) await tx.organization.update({ where: { id: ctx.actor.organizationId }, data: { name: input.legalName } });
    await audit(tx, ctx, { resourceType: "office", resourceId: ctx.actor.organizationId, operation: "office.update", summary: "تعديل إعدادات المكتب", before: officeDTO(before), after: officeDTO(after) });
    return officeDTO(after);
  });
}

const preferencesBody = z.object({
  hearingReminders: z.boolean().optional(),
  taskReminders: z.boolean().optional(),
  scheduleConflicts: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  defaultReminderMinutes: z.number().int().min(0).max(43200).optional(),
});

export async function updatePreferences(ctx: Ctx, raw: unknown): Promise<NotificationPreferenceDTO> {
  const input = parse(preferencesBody, raw);
  await preferences(prisma, ctx);
  await prisma.notificationPreference.update({ where: { organizationId_userId: { organizationId: ctx.actor.organizationId, userId: ctx.actor.userId } }, data: input });
  return preferences(prisma, ctx);
}

const profileBody = z.object({ name: requiredText(120, "يرجى إدخال الاسم الكامل").optional(), phone: optionalPhone, barNumber: optionalText(40) });

export async function updateProfile(ctx: Ctx, raw: unknown): Promise<ProfileDTO> {
  const input = parse(profileBody, raw);
  await prisma.$transaction(async (tx) => {
    if (input.name) await tx.user.update({ where: { id: ctx.actor.userId }, data: { name: input.name } });
    await tx.member.update({
      where: { organizationId_userId: { organizationId: ctx.actor.organizationId, userId: ctx.actor.userId } },
      data: { ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(input.barNumber !== undefined ? { barNumber: input.barNumber } : {}) },
    });
    await audit(tx, ctx, { resourceType: "user", resourceId: ctx.actor.userId, operation: "profile.update", summary: "تعديل الملف الشخصي" });
  });
  return profile(ctx);
}

// ——— Members ———

const memberInclude = { user: { select: { name: true, email: true } } } satisfies Prisma.MemberInclude;

function memberDTO(m: Prisma.MemberGetPayload<{ include: typeof memberInclude }>): MemberDTO {
  return {
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role as Role,
    phone: m.phone,
    barNumber: m.barNumber,
    active: !m.deactivatedAt,
    deactivatedAt: m.deactivatedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Everyone sees active colleagues (for assignee pickers); admins also see deactivated members. */
export async function listMembers(ctx: Ctx, includeInactive: boolean): Promise<MemberDTO[]> {
  const all = includeInactive && ctx.actor.role === "admin";
  const rows = await prisma.member.findMany({
    where: { organizationId: ctx.actor.organizationId, ...(all ? {} : { deactivatedAt: null }) },
    include: memberInclude,
    orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  return rows.map(memberDTO);
}

const password = z
  .string({ required_error: "كلمة المرور مطلوبة" })
  .min(PASSWORD_MIN_LENGTH, `كلمة المرور يجب أن تحتوي على ${PASSWORD_MIN_LENGTH} أحرف على الأقل`)
  .max(128, "كلمة المرور طويلة جداً");

const createMemberBody = z.object({
  name: requiredText(120, "يرجى إدخال الاسم"),
  email: z.string().trim().toLowerCase().email("البريد الإلكتروني غير صالح").max(200),
  role: z.enum(ROLES, { errorMap: () => ({ message: "دور غير صالح" }) }),
  password,
  phone: optionalPhone,
  barNumber: optionalText(40),
});

export async function hashPassword(plain: string): Promise<string> {
  const context = await auth().$context;
  return context.password.hash(plain);
}

export async function createMember(ctx: Ctx, raw: unknown): Promise<MemberDTO> {
  assertCan(ctx, "members:manage");
  const input = parse(createMemberBody, raw);
  const hash = await hashPassword(input.password);
  try {
    const member = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existing) throw new AppError("CONFLICT", "يوجد حساب مسجّل بهذا البريد الإلكتروني.");
      const userId = randomUUID().replace(/-/g, "");
      const now = new Date();
      await tx.user.create({ data: { id: userId, name: input.name, email: input.email, emailVerified: true, createdAt: now, updatedAt: now } });
      await tx.account.create({ data: { id: randomUUID().replace(/-/g, ""), accountId: userId, providerId: "credential", userId, password: hash, createdAt: now, updatedAt: now } });
      const m = await tx.member.create({
        data: { id: randomUUID().replace(/-/g, ""), organizationId: ctx.actor.organizationId, userId, role: input.role, createdAt: now, phone: input.phone ?? null, barNumber: input.barNumber ?? null },
        include: memberInclude,
      });
      await tx.notificationPreference.create({ data: { organizationId: ctx.actor.organizationId, userId } });
      await audit(tx, ctx, { resourceType: "member", resourceId: userId, operation: "member.create", summary: "إضافة عضو إلى المكتب", after: { role: input.role } });
      return m;
    });
    return memberDTO(member);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("CONFLICT", "يوجد حساب مسجّل بهذا البريد الإلكتروني.");
    throw err;
  }
}

async function loadMember(tx: Tx, ctx: Ctx, userId: string) {
  const m = await tx.member.findUnique({ where: { organizationId_userId: { organizationId: ctx.actor.organizationId, userId } }, include: memberInclude });
  if (!m) throw notFound("العضو");
  return m;
}

async function assertAnotherAdmin(tx: Tx, ctx: Ctx, excludingUserId: string) {
  const admins = await tx.member.count({ where: { organizationId: ctx.actor.organizationId, role: "admin", deactivatedAt: null, userId: { not: excludingUserId } } });
  if (admins === 0) throw new AppError("CONFLICT", "يجب أن يبقى للمكتب مدير نشط واحد على الأقل.");
}

export async function updateMemberRole(ctx: Ctx, userId: string, raw: unknown): Promise<MemberDTO> {
  assertCan(ctx, "members:manage");
  const input = parse(z.object({ role: z.enum(ROLES, { errorMap: () => ({ message: "دور غير صالح" }) }) }), raw);
  if (userId === ctx.actor.userId) throw new AppError("CONFLICT", "لا يمكنك تغيير دورك بنفسك.");
  return prisma.$transaction(async (tx) => {
    const m = await loadMember(tx, ctx, userId);
    if (m.role === input.role) return memberDTO(m);
    if (m.role === "admin") await assertAnotherAdmin(tx, ctx, userId);
    if (m.role === "lawyer" || m.role === "admin") {
      const assigned = await tx.case.count({ where: { organizationId: ctx.actor.organizationId, assignedLawyerId: userId, status: { not: "CLOSED" } } });
      if (assigned > 0 && input.role === "clerk") throw new AppError("CONFLICT", `هذا العضو مكلّف بـ ${assigned} ملفات مفتوحة: أعد تكليفها قبل تغيير دوره.`);
    }
    const updated = await tx.member.update({ where: { id: m.id }, data: { role: input.role }, include: memberInclude });
    await audit(tx, ctx, { resourceType: "member", resourceId: userId, operation: "member.role", summary: "تغيير دور عضو", before: { role: m.role }, after: { role: input.role } });
    return memberDTO(updated);
  });
}

export async function setMemberActive(ctx: Ctx, userId: string, active: boolean): Promise<MemberDTO> {
  assertCan(ctx, "members:manage");
  if (userId === ctx.actor.userId) throw new AppError("CONFLICT", "لا يمكنك تعطيل حسابك بنفسك.");
  return prisma.$transaction(async (tx) => {
    const m = await loadMember(tx, ctx, userId);
    if (!m.deactivatedAt === active) return memberDTO(m);
    if (!active && m.role === "admin") await assertAnotherAdmin(tx, ctx, userId);
    const updated = await tx.member.update({ where: { id: m.id }, data: { deactivatedAt: active ? null : new Date() }, include: memberInclude });
    if (!active) {
      // Sign the member out of this office immediately.
      await tx.session.deleteMany({ where: { userId, OR: [{ activeOrganizationId: ctx.actor.organizationId }, { activeOrganizationId: null }] } });
    }
    await audit(tx, ctx, { resourceType: "member", resourceId: userId, operation: active ? "member.reactivate" : "member.deactivate", summary: active ? "إعادة تفعيل عضو" : "تعطيل عضو" });
    return memberDTO(updated);
  });
}

export async function resetMemberPassword(ctx: Ctx, userId: string, raw: unknown): Promise<{ ok: true }> {
  assertCan(ctx, "members:manage");
  const input = parse(z.object({ password }), raw);
  const hash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    await loadMember(tx, ctx, userId);
    const updated = await tx.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: hash, updatedAt: new Date() } });
    if (updated.count === 0) throw notFound("حساب العضو");
    await tx.session.deleteMany({ where: { userId } });
    await audit(tx, ctx, { resourceType: "member", resourceId: userId, operation: "member.password.reset", summary: "تعيين كلمة مرور جديدة لعضو" });
  });
  return { ok: true };
}

// ——— Audit log ———

const auditQuery = pagination.extend({
  resourceType: z.string().trim().max(40).optional(),
  actorId: id.optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export async function listAudit(ctx: Ctx, raw: unknown): Promise<Paginated<AuditEntryDTO>> {
  assertCan(ctx, "audit:read");
  const q = parse(auditQuery, raw);
  const tz = ctx.actor.office.timeZone;
  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from) createdAt.gte = dayRange(q.from, tz).start;
  if (q.to) createdAt.lt = dayRange(q.to, tz).end;
  const where: Prisma.AuditLogWhereInput = {
    organizationId: ctx.actor.organizationId,
    ...(q.resourceType ? { resourceType: q.resourceType } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.outcome ? { outcome: q.outcome } : {}),
    ...(q.from || q.to ? { createdAt } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: r.actor ? { userId: r.actor.id, name: r.actor.name } : null,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      operation: r.operation,
      outcome: r.outcome,
      summary: r.summary,
      requestId: r.requestId,
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}
