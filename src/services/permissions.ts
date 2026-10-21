import type { LegalCase, OfficePolicy, OperationType, Role, TeamMember } from "@/types";

export type Permission =
  | "case:read"
  | "case:write"
  | "document:read"
  | "note:write"
  | "hearing:write"
  | "task:write"
  | "finance:read"
  | "finance:write"
  | "case:link"
  | "audit:read"
  | "archive:process"
  | "policy:manage";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  lawyer: [
    "case:read", "case:write", "document:read", "note:write", "hearing:write", "task:write",
    "finance:read", "finance:write", "case:link", "audit:read", "archive:process", "policy:manage",
  ],
  associate: ["case:read", "document:read", "note:write", "hearing:write", "task:write", "finance:read", "case:link", "archive:process"],
  secretary: ["case:read", "document:read", "hearing:write", "task:write", "archive:process", "case:link"],
  accountant: ["case:read", "finance:read", "finance:write", "task:write"],
  admin: ["case:read", "document:read", "hearing:write", "task:write", "case:link", "audit:read", "archive:process", "policy:manage"],
};

export const ROLE_LABELS: Record<Role, string> = {
  lawyer: "محامٍ — صاحب المكتب",
  associate: "محامية مساعدة",
  secretary: "كاتبة المكتب",
  accountant: "مسؤول مالي",
  admin: "مديرة المكتب (إدارة النظام)",
};

export function can(user: TeamMember, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/** Per-case access control: a member only sees files they are staffed on. */
export function canAccessCase(user: TeamMember, legalCase: Pick<LegalCase, "team">): boolean {
  return legalCase.team.includes(user.id);
}

/** Who may PROPOSE an operation (prepare it for approval). */
export const PROPOSE_PERMISSION: Record<OperationType, Permission> = {
  "hearing.create": "hearing:write",
  "hearing.update": "hearing:write",
  "task.create": "task:write",
  "reminder.create": "task:write",
  "payment.reminder_draft": "finance:read",
  "receipt.issue": "finance:write",
  "document.link": "case:link",
  "archive.verify": "archive:process",
  "archive.finalize": "archive:process",
};

/** Office policy: which roles may APPROVE each operation. AI agents never approve. */
const APPROVER_ROLES: Record<OperationType, Role[]> = {
  "hearing.create": ["lawyer", "associate"],
  "hearing.update": ["lawyer", "associate"],
  "task.create": ["lawyer", "associate", "admin"],
  "reminder.create": ["lawyer", "associate", "admin"],
  "payment.reminder_draft": ["lawyer", "accountant"],
  "receipt.issue": ["lawyer", "accountant"],
  "document.link": ["lawyer", "associate"],
  "archive.verify": ["lawyer", "associate"],
  "archive.finalize": ["lawyer", "admin"],
};

/** Operations a clerk may approve themselves when the office relaxes the lawyer-approval rule. */
const CLERK_ELIGIBLE: OperationType[] = ["hearing.create", "hearing.update", "task.create", "reminder.create", "document.link"];

export function approverRolesFor(operation: OperationType, policy: OfficePolicy): Role[] {
  const roles = [...APPROVER_ROLES[operation]];
  if (!policy.clerkRequiresLawyerApproval && CLERK_ELIGIBLE.includes(operation)) roles.push("secretary");
  return roles;
}

export function approverLabel(roles: Role[]): string {
  return roles.map((r) => ROLE_LABELS[r]).join(" أو ");
}

export const PERMISSION_DENIED_MESSAGES: Record<Permission, string> = {
  "case:read": "ليست لديك صلاحية الاطلاع على هذه القضية.",
  "case:write": "ليست لديك صلاحية تعديل القضايا.",
  "document:read": "ليست لديك صلاحية الاطلاع على الوثائق.",
  "note:write": "ليست لديك صلاحية إضافة الملاحظات.",
  "hearing:write": "ليست لديك صلاحية برمجة أو تعديل الجلسات.",
  "task:write": "ليست لديك صلاحية إنشاء المهام.",
  "finance:read": "ليست لديك صلاحية الاطلاع على البيانات المالية.",
  "finance:write": "تسجيل الدفعات وإصدار الوصولات يتطلب صلاحية مالية.",
  "case:link": "ليست لديك صلاحية ربط الوثائق بالقضايا.",
  "audit:read": "ليست لديك صلاحية الاطلاع على سجل العمليات.",
  "archive:process": "ليست لديك صلاحية معالجة الأرشيف.",
  "policy:manage": "ليست لديك صلاحية تعديل سياسة المكتب.",
};
