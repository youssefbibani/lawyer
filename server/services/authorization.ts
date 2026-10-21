/**
 * Business authorization: role permissions per office, and per-case data scopes.
 *
 * Every organization-owned query is built from these scopes, so a record outside the caller's
 * office (or outside the cases they may see) is indistinguishable from a missing one (404).
 */
import type { Prisma } from "@prisma/client";

import { PERMISSIONS, type Permission, type Role } from "../../shared/api.js";
import type { Actor, Ctx } from "../http/context.js";
import { AppError, notFound } from "../http/errors.js";
import type { Tx } from "../db.js";

const LAWYER: Permission[] = [
  "client:read",
  "client:write",
  "case:read",
  "case:create",
  "case:update",
  "case:status",
  "case:assign",
  "note:write",
  "hearing:write",
  "hearing:cancel",
  "finance:read",
  "finance:write",
  "payment:record",
  "payment:void",
  "task:write",
];

/** Clerks prepare work: no case status / lawyer changes, no hearing cancellation, no finance by default. */
const CLERK: Permission[] = ["client:read", "client:write", "case:read", "case:create", "case:update", "note:write", "hearing:write", "task:write"];

export function permissionsFor(role: Role, office: Actor["office"]): Permission[] {
  if (role === "admin") return [...PERMISSIONS];
  if (role === "lawyer") return LAWYER;
  return office.clerksCanRecordPayments ? [...CLERK, "finance:read", "payment:record"] : CLERK;
}

export function can(actor: Actor, permission: Permission): boolean {
  return permissionsFor(actor.role, actor.office).includes(permission);
}

const DENIED: Partial<Record<Permission, string>> = {
  "case:status": "تغيير حالة القضية مقصور على المحامين ومدير المكتب.",
  "case:assign": "تغيير المحامي المكلّف أو فريق الملف مقصور على المحامين ومدير المكتب.",
  "hearing:cancel": "إلغاء الجلسات مقصور على المحامين ومدير المكتب.",
  "finance:read": "ليست لديك صلاحية الاطلاع على البيانات المالية.",
  "finance:write": "إدارة اتفاقيات الأتعاب تتطلب صلاحية مالية.",
  "payment:record": "تسجيل الدفعات يتطلب صلاحية مالية.",
  "payment:void": "إلغاء الدفعات مقصور على المحامين ومدير المكتب.",
  "settings:office": "إعدادات المكتب مقصورة على مدير المكتب.",
  "members:manage": "إدارة أعضاء المكتب مقصورة على مدير المكتب.",
  "audit:read": "سجل العمليات مقصور على مدير المكتب.",
};

export function assertCan(ctx: Ctx, permission: Permission): void {
  if (!can(ctx.actor, permission)) {
    throw new AppError("FORBIDDEN", DENIED[permission] ?? "ليست لديك صلاحية القيام بهذه العملية.", { data: { permission } });
  }
}

export function seesAllCases(actor: Actor): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "lawyer") return actor.office.lawyersSeeAllCases;
  return actor.office.clerksSeeAllCases;
}

/** Cases the actor may see. Always includes the office filter. */
export function caseScope(actor: Actor): Prisma.CaseWhereInput {
  const base: Prisma.CaseWhereInput = { organizationId: actor.organizationId };
  if (seesAllCases(actor)) return base;
  if (actor.role === "lawyer") {
    return { ...base, OR: [{ assignedLawyerId: actor.userId }, { members: { some: { userId: actor.userId } } }] };
  }
  return { ...base, members: { some: { userId: actor.userId } } };
}

/** Clients visible to the actor: all office clients, or those tied to a visible case / created by them / not yet on any case. */
export function clientScope(actor: Actor): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { organizationId: actor.organizationId };
  if (seesAllCases(actor)) return base;
  return {
    ...base,
    OR: [{ createdById: actor.userId }, { cases: { none: {} } }, { cases: { some: { case: caseScope(actor) } } }],
  };
}

/** Tasks: case tasks follow case access; tasks without a case are visible to their assignee and creator (and admins). */
export function taskScope(actor: Actor): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = { organizationId: actor.organizationId };
  if (actor.role === "admin") return base;
  return {
    ...base,
    OR: [
      { caseId: { not: null }, case: caseScope(actor) },
      { caseId: null, OR: [{ assigneeId: actor.userId }, { createdById: actor.userId }] },
    ],
  };
}

export async function loadAccessibleCase(tx: Tx, actor: Actor, caseId: string) {
  const found = await tx.case.findFirst({ where: { AND: [{ id: caseId }, caseScope(actor)] }, select: { id: true, reference: true, status: true, assignedLawyerId: true, archivedAt: true } });
  if (!found) throw notFound("الملف");
  return found;
}

/** Validates that a user id is an ACTIVE member of the actor's office (for assignees, lawyers, staff). */
export async function loadActiveMember(tx: Tx, actor: Actor, userId: string, roles?: Role[]) {
  const member = await tx.member.findUnique({
    where: { organizationId_userId: { organizationId: actor.organizationId, userId } },
    select: { userId: true, role: true, deactivatedAt: true, user: { select: { name: true } } },
  });
  if (!member || member.deactivatedAt) throw new AppError("VALIDATION_FAILED", "العضو المحدد غير موجود ضمن أعضاء المكتب النشطين.");
  if (roles && !roles.includes(member.role as Role)) {
    throw new AppError("VALIDATION_FAILED", "العضو المحدد لا يملك الدور المطلوب لهذه المهمة.");
  }
  return member;
}
