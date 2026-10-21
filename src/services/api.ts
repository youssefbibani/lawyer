/**
 * Application service layer ("server" boundary of the prototype).
 *
 * Every read is filtered by the acting user's role and per-case access; every write is
 * validated, authorised, persisted (with read-back verification) and audited.
 * The assistant never writes directly: it prepares an action, the user confirms it,
 * and the confirmed action is executed through these same functions.
 */
import { z } from "zod";

import type {
  OperationType,
  ArchiveDocument,
  AssistantPrefs,
  AuditEntry,
  Brief,
  Hearing,
  LegalCase,
  Payment,
  PaymentStatus,
  ReceiptRecord,
  Task,
  TeamMember,
  TimelineEvent,
} from "@/types";
import type { Conversation } from "@/services/assistant/types";
import { team } from "@/data/mock";
import { commit, getDB, newId, type DemoDatabase } from "@/services/db";
import { can, canAccessCase, PERMISSION_DENIED_MESSAGES, type Permission } from "@/services/permissions";
import { addDays, combineDateTime, parseISODate, toISODate, urgencyOf } from "@/lib/dates";
import { hashValue } from "@/lib/hash";
import { sealEntry } from "@/services/audit";

export type ApiErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "storage";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code: ApiErrorCode };
export type Via = "manual" | "assistant";

const fail = <T>(code: ApiErrorCode, error: string): ApiResult<T> => ({ ok: false, code, error });

// ——— Identity ———

export function getTeam(): TeamMember[] {
  return team;
}

export function getMember(id: string | undefined): TeamMember | undefined {
  return team.find((m) => m.id === id);
}

export function currentUser(db: DemoDatabase = getDB()): TeamMember {
  return getMember(db.currentUserId) ?? team[0];
}

function requirePermission(user: TeamMember, permission: Permission): string | null {
  return can(user, permission) ? null : PERMISSION_DENIED_MESSAGES[permission];
}

// ——— Read model (permission-filtered) ———

export function accessibleCases(db: DemoDatabase = getDB(), user = currentUser(db)): LegalCase[] {
  return db.cases.filter((c) => canAccessCase(user, c));
}

export function findAccessibleCase(caseId: string | undefined, db = getDB(), user = currentUser(db)): LegalCase | undefined {
  if (!caseId) return undefined;
  const legalCase = db.cases.find((c) => c.id === caseId);
  return legalCase && canAccessCase(user, legalCase) ? legalCase : undefined;
}

export function caseByRef(ref: string, db = getDB(), user = currentUser(db)): LegalCase | undefined {
  return accessibleCases(db, user).find((c) => c.ref === ref);
}

export function accessibleHearings(db = getDB(), user = currentUser(db)): Hearing[] {
  const refs = new Set(accessibleCases(db, user).map((c) => c.ref));
  return db.hearings.filter((h) => refs.has(h.caseRef));
}

export function hearingsForCase(caseId: string, db = getDB(), user = currentUser(db)): Hearing[] {
  const legalCase = findAccessibleCase(caseId, db, user);
  if (!legalCase) return [];
  return sortHearings(db.hearings.filter((h) => h.caseRef === legalCase.ref));
}

export function sortHearings(list: Hearing[]): Hearing[] {
  return [...list].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function upcomingHearings(
  from: Date,
  to: Date,
  db = getDB(),
  user = currentUser(db),
): Hearing[] {
  const start = toISODate(from);
  const end = toISODate(to);
  return sortHearings(accessibleHearings(db, user).filter((h) => h.date >= start && h.date <= end));
}

export function nextHearingForCase(caseId: string, now = new Date(), db = getDB(), user = currentUser(db)): Hearing | undefined {
  const today = toISODate(now);
  return hearingsForCase(caseId, db, user).find((h) => h.date >= today);
}

export function caseNextHearingDate(legalCase: LegalCase, now = new Date(), db = getDB()): string | undefined {
  const today = toISODate(now);
  const next = sortHearings(db.hearings.filter((h) => h.caseRef === legalCase.ref && h.date >= today))[0];
  return next?.date ?? legalCase.nextHearing;
}

/** Hearings within one hour of the requested slot on the same day. */
export function findHearingConflicts(
  date: string,
  time: string | undefined,
  options: { excludeId?: string } = {},
  db = getDB(),
  user = currentUser(db),
): Hearing[] {
  if (!date || !time) return [];
  const target = combineDateTime(date, time).getTime();
  return accessibleHearings(db, user).filter((h) => {
    if (h.id === options.excludeId || h.date !== date) return false;
    return Math.abs(combineDateTime(h.date, h.time).getTime() - target) < 60 * 60 * 1000;
  });
}

export function hearingConflictGroups(db = getDB(), user = currentUser(db)): Hearing[][] {
  const groups = new Map<string, Hearing[]>();
  accessibleHearings(db, user).forEach((h) => {
    const key = `${h.date}_${h.time}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

export function accessibleTasks(db = getDB(), user = currentUser(db)): Task[] {
  const caseIds = new Set(accessibleCases(db, user).map((c) => c.id));
  return db.tasks.filter((t) => (t.caseId ? caseIds.has(t.caseId) : true));
}

/** Tasks/reminders due in the same hour for the same assignee, plus hearings at that time. */
export function findTaskConflicts(
  input: { dueDate: string; dueTime?: string; assigneeId: string; excludeId?: string },
  db = getDB(),
  user = currentUser(db),
): { tasks: Task[]; hearings: Hearing[] } {
  if (!input.dueTime) return { tasks: [], hearings: [] };
  const target = combineDateTime(input.dueDate, input.dueTime).getTime();
  const near = (date: string, time?: string) =>
    !!time && date === input.dueDate && Math.abs(combineDateTime(date, time).getTime() - target) < 60 * 60 * 1000;
  return {
    tasks: accessibleTasks(db, user).filter(
      (t) => t.id !== input.excludeId && !t.completed && t.assigneeId === input.assigneeId && near(t.dueDate, t.dueTime),
    ),
    hearings: accessibleHearings(db, user).filter((h) => near(h.date, h.time)),
  };
}

export function accessibleDocuments(db = getDB(), user = currentUser(db)): ArchiveDocument[] {
  if (!can(user, "document:read")) return [];
  const caseIds = new Set(accessibleCases(db, user).map((c) => c.id));
  return db.documents.filter((d) => (d.caseId ? caseIds.has(d.caseId) : true));
}

export function documentsForCase(caseId: string, db = getDB(), user = currentUser(db)): ArchiveDocument[] {
  const legalCase = findAccessibleCase(caseId, db, user);
  if (!legalCase) return [];
  const linked = new Set(db.docLinks.filter((l) => l.caseId === caseId).map((l) => l.documentId));
  return accessibleDocuments(db, user).filter((d) => d.caseId === caseId || linked.has(d.id));
}

export function findAccessibleDocument(id: string | undefined, db = getDB(), user = currentUser(db)) {
  return accessibleDocuments(db, user).find((d) => d.id === id);
}

export function accessiblePayments(db = getDB(), user = currentUser(db)): Payment[] {
  if (!can(user, "finance:read")) return [];
  const refs = new Set(accessibleCases(db, user).map((c) => c.ref));
  return db.payments.filter((p) => refs.has(p.caseRef));
}

export function paymentForCase(legalCase: LegalCase, db = getDB(), user = currentUser(db)) {
  return accessiblePayments(db, user).find((p) => p.caseRef === legalCase.ref);
}

// ——— Write helpers ———

/** Appends a sealed (hash-chained) entry. The log is never truncated or rewritten. */
export function audit(db: DemoDatabase, entry: Omit<AuditEntry, "id" | "at" | "actorId" | "hash" | "prevHash">): DemoDatabase {
  const approvalId = activeApproval?.id;
  const details = approvalId ? { ...entry.details, approvalId } : entry.details;
  const record = sealEntry({ id: newId("audit"), at: new Date().toISOString(), actorId: db.currentUserId, ...entry, details }, db.audit[0]);
  return { ...db, audit: [record, ...db.audit] };
}

// ——— Approval gate ———
// Writes that originate from the assistant (and every archive verification/finalisation) may only
// run inside runUnderApproval(), which requires a stored request that a human approved for these
// exact parameters. Direct calls — e.g. createHearing(input, "assistant") — are refused.

let activeApproval: { id: string; operation: OperationType; paramsHash: string } | null = null;

export function runUnderApproval<T>(approvalId: string, fn: () => T): T {
  const request = getDB().approvals.find((a) => a.id === approvalId);
  if (!request || request.status !== "approved" || !request.decision || request.decision.paramsHash !== request.paramsHash) {
    throw new Error("approval-not-valid");
  }
  if (hashValue(request.params) !== request.paramsHash) throw new Error("approval-params-tampered");
  const previous = activeApproval;
  activeApproval = { id: request.id, operation: request.operation, paramsHash: request.paramsHash };
  try {
    return fn();
  } finally {
    activeApproval = previous;
  }
}

/** Returns an error message when no matching approval is active for this exact operation. */
export function approvalViolation(operation: OperationType, params: unknown): string | null {
  if (!activeApproval || activeApproval.operation !== operation) {
    return "هذه العملية تتطلب موافقة بشرية صريحة عبر نظام طلبات الموافقة.";
  }
  if (hashValue(params) !== activeApproval.paramsHash) {
    return "معطيات العملية لا تطابق ما تمت الموافقة عليه.";
  }
  return null;
}

export function currentApprovalId(): string | undefined {
  return activeApproval?.id;
}

function timeline(db: DemoDatabase, event: Omit<TimelineEvent, "id">): DemoDatabase {
  return { ...db, timeline: [...db.timeline, { id: newId("tl"), ...event }] };
}

function persisted<T>(result: ReturnType<typeof commit>, data: T): ApiResult<T> {
  return result.ok ? { ok: true, data } : fail("storage", result.error);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "توقيت غير صالح");

function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة";
}

// ——— Cases ———

const caseInput = z.object({
  client: z.string().trim().min(1),
  ref: z.string().trim().min(1),
  type: z.string().min(1),
  court: z.string().trim().min(1),
  status: z.string().min(1),
  nextHearing: isoDate.optional(),
  description: z.string().trim().min(1),
});

export function createCase(input: z.infer<typeof caseInput>): ApiResult<LegalCase> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "case:write");
  if (denied) return fail("forbidden", denied);
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  if (db.cases.some((c) => c.ref === parsed.data.ref)) return fail("conflict", "يوجد ملف مسجّل بنفس المرجع.");
  const legalCase: LegalCase = {
    id: newId("case"),
    ref: parsed.data.ref,
    client: parsed.data.client,
    type: parsed.data.type as LegalCase["type"],
    status: parsed.data.status as LegalCase["status"],
    court: parsed.data.court,
    openingDate: toISODate(new Date()),
    nextHearing: parsed.data.nextHearing,
    documents: 0,
    description: parsed.data.description,
    assignedLawyer: user.name,
    feesAgreed: 0,
    feesPaid: 0,
    team: Array.from(new Set([user.id, "u1", "u3", "u4"])),
  };
  const result = commit((d) =>
    audit(
      timeline({ ...d, cases: [legalCase, ...d.cases] }, {
        caseId: legalCase.id, date: legalCase.openingDate, title: "فتح الملف",
        description: `تم فتح ملف القضية وتسجيلها تحت المرجع ${legalCase.ref}.`, icon: "file",
      }),
      { action: "case.create", entityType: "case", entityId: legalCase.id, summary: `فتح ملف ${legalCase.ref}`, via: "manual" },
    ),
  );
  return persisted(result, legalCase);
}

// ——— Hearings ———

const hearingInput = z.object({
  caseId: z.string().min(1, "يرجى اختيار القضية"),
  court: z.string().trim().min(1, "يرجى إدخال المحكمة"),
  room: z.string().trim().min(1, "يرجى إدخال القاعة"),
  type: z.string().trim().min(1, "يرجى إدخال نوع الجلسة"),
  date: isoDate,
  time: hhmm,
});
export type HearingInput = z.infer<typeof hearingInput>;

export function createHearing(input: HearingInput, via: Via = "manual"): ApiResult<Hearing> {
  if (via === "assistant") {
    const violation = approvalViolation("hearing.create", input);
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "hearing:write");
  if (denied) return fail("forbidden", denied);
  const parsed = hearingInput.safeParse(input);
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  const legalCase = findAccessibleCase(parsed.data.caseId, db, user);
  if (!legalCase) return fail("not_found", "القضية غير موجودة أو غير مصرّح لك بها.");

  const urgency = urgencyOf(parsed.data.date);
  const hearing: Hearing = {
    id: newId("hearing"),
    caseId: legalCase.id,
    caseRef: legalCase.ref,
    client: legalCase.client,
    court: parsed.data.court,
    room: parsed.data.room,
    type: parsed.data.type,
    date: parsed.data.date,
    time: parsed.data.time,
    urgency: urgency === "past" ? "later" : urgency,
  };
  const result = commit((d) => {
    const cases = d.cases.map((c) =>
      c.id === legalCase.id && (!c.nextHearing || c.nextHearing < toISODate(new Date()) || hearing.date < c.nextHearing)
        ? { ...c, nextHearing: hearing.date }
        : c,
    );
    const withHearing = timeline({ ...d, cases, hearings: [...d.hearings, hearing] }, {
      caseId: legalCase.id, date: toISODate(new Date()), title: "برمجة جلسة",
      description: `${hearing.type} بتاريخ ${hearing.date} على الساعة ${hearing.time}.`, icon: "calendar",
    });
    return audit(withHearing, {
      action: "hearing.create", entityType: "hearing", entityId: hearing.id, summary: `برمجة جلسة للقضية ${legalCase.ref}`, via,
    });
  });
  return persisted(result, hearing);
}

const hearingPatch = z.object({ date: isoDate.optional(), time: hhmm.optional(), room: z.string().optional(), type: z.string().optional() });

export function updateHearing(id: string, patch: z.infer<typeof hearingPatch>, via: Via = "manual"): ApiResult<Hearing> {
  if (via === "assistant") {
    const violation = approvalViolation("hearing.update", { hearingId: id, ...patch });
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "hearing:write");
  if (denied) return fail("forbidden", denied);
  const parsed = hearingPatch.safeParse(patch);
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  const existing = accessibleHearings(db, user).find((h) => h.id === id);
  if (!existing) return fail("not_found", "الجلسة غير موجودة أو غير مصرّح لك بها.");
  const updated: Hearing = { ...existing, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v)) };
  const legalCase = caseByRef(existing.caseRef, db, user);
  const result = commit((d) => {
    let next: DemoDatabase = { ...d, hearings: d.hearings.map((h) => (h.id === id ? updated : h)) };
    if (legalCase) {
      next = timeline(next, {
        caseId: legalCase.id, date: toISODate(new Date()), title: "تعديل موعد جلسة",
        description: `من ${existing.date} ${existing.time} إلى ${updated.date} ${updated.time}.`, icon: "calendar",
      });
    }
    return audit(next, {
      action: "hearing.update", entityType: "hearing", entityId: id, summary: `تعديل جلسة القضية ${existing.caseRef}`, via,
    });
  });
  return persisted(result, updated);
}

// ——— Tasks & reminders ———

const taskInput = z.object({
  kind: z.enum(["task", "reminder"]),
  title: z.string().trim().min(1, "يرجى إدخال عنوان المهمة"),
  description: z.string().optional(),
  caseId: z.string().optional(),
  hearingId: z.string().optional(),
  assigneeId: z.string().min(1, "يرجى اختيار المكلّف"),
  dueDate: isoDate,
  dueTime: hhmm.optional(),
  priority: z.enum(["high", "medium", "low"]),
  channels: z.object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean() }),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
});
export type TaskInput = z.infer<typeof taskInput>;

export function createTask(input: TaskInput, via: Via = "manual"): ApiResult<Task> {
  if (via === "assistant") {
    const violation = approvalViolation(input.kind === "reminder" ? "reminder.create" : "task.create", input);
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "task:write");
  if (denied) return fail("forbidden", denied);
  const parsed = taskInput.safeParse({ ...input, dueTime: input.dueTime || undefined, caseId: input.caseId || undefined });
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  const legalCase = parsed.data.caseId ? findAccessibleCase(parsed.data.caseId, db, user) : undefined;
  if (parsed.data.caseId && !legalCase) return fail("not_found", "القضية المرتبطة غير موجودة أو غير مصرّح لك بها.");
  if (!getMember(parsed.data.assigneeId)) return fail("validation", "المكلّف غير موجود ضمن فريق المكتب.");

  const task: Task = {
    id: newId("task"),
    ...parsed.data,
    completed: false,
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    source: via,
  };
  const result = commit((d) => {
    let next: DemoDatabase = { ...d, tasks: [...d.tasks, task] };
    if (legalCase) {
      next = timeline(next, {
        caseId: legalCase.id, date: toISODate(new Date()),
        title: task.kind === "reminder" ? "تذكير جديد" : "مهمة جديدة",
        description: `${task.title} — موعد الإنجاز ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}.`, icon: "task",
      });
    }
    return audit(next, {
      action: `${task.kind}.create`, entityType: "task", entityId: task.id,
      summary: legalCase ? `إنشاء ${task.kind === "reminder" ? "تذكير" : "مهمة"} مرتبطة بالقضية ${legalCase.ref}` : `إنشاء ${task.kind === "reminder" ? "تذكير" : "مهمة"}`,
      via,
    });
  });
  return persisted(result, task);
}

export function updateTask(id: string, input: TaskInput): ApiResult<Task> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "task:write");
  if (denied) return fail("forbidden", denied);
  const existing = accessibleTasks(db, user).find((t) => t.id === id);
  if (!existing) return fail("not_found", "المهمة غير موجودة.");
  const parsed = taskInput.safeParse({ ...input, dueTime: input.dueTime || undefined, caseId: input.caseId || undefined });
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  if (parsed.data.caseId && !findAccessibleCase(parsed.data.caseId, db, user)) {
    return fail("not_found", "القضية المرتبطة غير موجودة أو غير مصرّح لك بها.");
  }
  const rescheduled = parsed.data.dueDate !== existing.dueDate || parsed.data.dueTime !== existing.dueTime;
  const updated: Task = { ...existing, ...parsed.data, firedAt: rescheduled ? undefined : existing.firedAt };
  const result = commit((d) =>
    audit({ ...d, tasks: d.tasks.map((t) => (t.id === id ? updated : t)) }, {
      action: "task.update", entityType: "task", entityId: id, summary: "تعديل مهمة", via: "manual",
    }),
  );
  return persisted(result, updated);
}

function nextOccurrence(task: Task): string {
  const due = parseISODate(task.dueDate);
  if (task.recurrence === "daily") return toISODate(addDays(due, 1));
  if (task.recurrence === "weekly") return toISODate(addDays(due, 7));
  const next = new Date(due);
  next.setMonth(next.getMonth() + 1);
  return toISODate(next);
}

export function setTaskCompleted(id: string, completed: boolean): ApiResult<{ task: Task; spawned?: Task }> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "task:write");
  if (denied) return fail("forbidden", denied);
  const existing = accessibleTasks(db, user).find((t) => t.id === id);
  if (!existing) return fail("not_found", "المهمة غير موجودة.");
  const updated: Task = { ...existing, completed, completedAt: completed ? new Date().toISOString() : undefined };
  const spawned: Task | undefined =
    completed && existing.recurrence !== "none" && !existing.completed
      ? { ...existing, id: newId("task"), dueDate: nextOccurrence(existing), completed: false, completedAt: undefined, firedAt: undefined, createdAt: new Date().toISOString() }
      : undefined;
  const result = commit((d) => {
    let next: DemoDatabase = {
      ...d,
      tasks: [...d.tasks.map((t) => (t.id === id ? updated : t)), ...(spawned ? [spawned] : [])],
    };
    if (completed && existing.caseId) {
      next = timeline(next, {
        caseId: existing.caseId, date: toISODate(new Date()), title: "إنجاز مهمة", description: existing.title, icon: "check",
      });
    }
    return audit(next, {
      action: completed ? "task.complete" : "task.reopen", entityType: "task", entityId: id,
      summary: completed ? "إنجاز مهمة" : "إعادة فتح مهمة", via: "manual",
    });
  });
  return persisted(result, { task: updated, spawned });
}

export function deleteTask(id: string): ApiResult<null> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "task:write");
  if (denied) return fail("forbidden", denied);
  if (!accessibleTasks(db, user).some((t) => t.id === id)) return fail("not_found", "المهمة غير موجودة.");
  const result = commit((d) =>
    audit({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }, {
      action: "task.delete", entityType: "task", entityId: id, summary: "حذف مهمة", via: "manual",
    }),
  );
  return persisted(result, null);
}

/** Records that an in-app reminder was actually shown in this browser. */
export function markReminderFired(id: string): void {
  commit((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, firedAt: new Date().toISOString() } : t)) }));
}

// ——— Notes, documents, links ———

export function addNote(caseId: string, content: string): ApiResult<null> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "note:write");
  if (denied) return fail("forbidden", denied);
  const legalCase = findAccessibleCase(caseId, db, user);
  if (!legalCase) return fail("not_found", "القضية غير موجودة.");
  if (!content.trim()) return fail("validation", "يرجى إدخال نص الملاحظة");
  const note = { id: newId("note"), caseId, date: new Date().toISOString(), author: user.name, content: content.trim() };
  const result = commit((d) =>
    audit({ ...d, notes: [note, ...d.notes] }, {
      action: "note.create", entityType: "note", entityId: note.id, summary: `إضافة ملاحظة للقضية ${legalCase.ref}`, via: "manual",
    }),
  );
  return persisted(result, null);
}

export function linkDocumentToCase(documentId: string, caseId: string, via: Via = "manual"): ApiResult<null> {
  if (via === "assistant") {
    const violation = approvalViolation("document.link", { documentId, caseId });
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "case:link");
  if (denied) return fail("forbidden", denied);
  const legalCase = findAccessibleCase(caseId, db, user);
  const doc = findAccessibleDocument(documentId, db, user);
  if (!legalCase || !doc) return fail("not_found", "الوثيقة أو القضية غير متاحة.");
  if (doc.caseId === caseId || db.docLinks.some((l) => l.documentId === documentId && l.caseId === caseId)) {
    return fail("conflict", "الوثيقة مرتبطة بهذه القضية مسبقاً.");
  }
  const link = { id: newId("link"), documentId, caseId, createdAt: new Date().toISOString(), createdBy: user.id };
  const result = commit((d) =>
    audit(
      timeline({ ...d, docLinks: [...d.docLinks, link] }, {
        caseId, date: toISODate(new Date()), title: "ربط وثيقة من الأرشيف", description: `${doc.title} (${doc.caseRef})`, icon: "file",
      }),
      { action: "document.link", entityType: "document", entityId: documentId, summary: `ربط وثيقة ${doc.caseRef} بالقضية ${legalCase.ref}`, via },
    ),
  );
  return persisted(result, null);
}

export function isDocumentLinked(documentId: string, caseId: string, db = getDB()): boolean {
  return db.docLinks.some((l) => l.documentId === documentId && l.caseId === caseId);
}

export function registerUploadedDocument(meta: {
  title: string;
  docType: string;
  caseId: string;
  pages: number;
  sizeLabel: string;
}): ApiResult<ArchiveDocument> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "document:read");
  if (denied) return fail("forbidden", denied);
  const legalCase = findAccessibleCase(meta.caseId, db, user);
  if (!legalCase) return fail("not_found", "القضية غير موجودة أو غير مصرّح لك بها.");
  const doc: ArchiveDocument = {
    id: newId("doc"),
    title: meta.title,
    docType: meta.docType,
    caseId: legalCase.id,
    caseRef: legalCase.ref,
    client: legalCase.client,
    date: toISODate(new Date()),
    size: meta.sizeLabel,
    source: "upload",
    language: "ar",
    pages: Array.from({ length: Math.max(1, meta.pages) }, (_, i) => ({
      number: i + 1,
      lang: "ar" as const,
      text: "",
    })),
    externalOrigin: true,
  };
  const result = commit((d) =>
    audit(
      timeline({ ...d, documents: [...d.documents, doc] }, {
        caseId: legalCase.id, date: doc.date, title: "إضافة وثيقة", description: `${doc.title} — بطاقة وصفية (بدون نص مستخرج)`, icon: "file",
      }),
      { action: "document.register", entityType: "document", entityId: doc.id, summary: `تسجيل وثيقة في القضية ${legalCase.ref}`, via: "manual" },
    ),
  );
  return persisted(result, doc);
}

// ——— Finance ———

function paymentStatus(paid: number, agreed: number): PaymentStatus {
  if (paid >= agreed) return "مسدّد";
  return paid > 0 ? "جزئي" : "غير مدفوع";
}

export function nextReceiptNumber(db = getDB(), now = new Date()): string {
  const year = now.getFullYear();
  const count = db.receipts.filter((r) => r.receiptNumber.startsWith(`REC-${year}-`)).length + 1;
  return `REC-${year}-${String(count).padStart(4, "0")}`;
}

const receiptInput = z.object({
  paymentId: z.string().min(1),
  amount: z.number({ invalid_type_error: "قيمة المبلغ غير صالحة" }).positive("قيمة المبلغ غير صالحة"),
  date: isoDate,
  receiptNumber: z.string().trim().min(1, "يرجى إدخال رقم الوصل"),
  notes: z.string().optional(),
});

export function recordPaymentReceipt(input: z.infer<typeof receiptInput>, via: Via = "manual"): ApiResult<ReceiptRecord> {
  if (via === "assistant") {
    const violation = approvalViolation("receipt.issue", input);
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "finance:write");
  if (denied) return fail("forbidden", denied);
  const parsed = receiptInput.safeParse(input);
  if (!parsed.success) return fail("validation", zodMessage(parsed.error));
  const payment = accessiblePayments(db, user).find((p) => p.id === parsed.data.paymentId);
  if (!payment) return fail("not_found", "سجل الأتعاب غير موجود أو غير مصرّح لك به.");
  if (parsed.data.amount > payment.remaining) {
    return fail("validation", `المبلغ يتجاوز المتبقي المستحق (${payment.remaining.toLocaleString("en-US")} د.ت).`);
  }
  if (db.receipts.some((r) => r.receiptNumber === parsed.data.receiptNumber)) {
    return fail("conflict", "رقم الوصل مستعمل مسبقاً.");
  }
  const receipt: ReceiptRecord = {
    id: newId("receipt"),
    ...parsed.data,
    caseRef: payment.caseRef,
    client: payment.client,
    createdAt: new Date().toISOString(),
    createdBy: user.id,
  };
  const paid = payment.paid + parsed.data.amount;
  const updatedPayment: Payment = {
    ...payment,
    paid,
    remaining: payment.agreed - paid,
    status: paymentStatus(paid, payment.agreed),
    lastPaymentDate: parsed.data.date,
  };
  const legalCase = caseByRef(payment.caseRef, db, user);
  const result = commit((d) => {
    let next: DemoDatabase = {
      ...d,
      receipts: [receipt, ...d.receipts],
      payments: d.payments.map((p) => (p.id === payment.id ? updatedPayment : p)),
      cases: d.cases.map((c) => (c.ref === payment.caseRef ? { ...c, feesPaid: paid } : c)),
    };
    if (legalCase) {
      next = timeline(next, {
        caseId: legalCase.id, date: parsed.data.date, title: "تسجيل دفعة",
        description: `وصل عدد ${receipt.receiptNumber}.`, icon: "check",
      });
    }
    return audit(next, {
      action: "receipt.create", entityType: "receipt", entityId: receipt.id,
      summary: `إصدار الوصل ${receipt.receiptNumber} للقضية ${payment.caseRef}`, via,
    });
  });
  return persisted(result, receipt);
}

export function savePaymentReminderDraft(paymentId: string, text: string, via: Via = "manual"): ApiResult<null> {
  if (via === "assistant") {
    const violation = approvalViolation("payment.reminder_draft", { paymentId, text });
    if (violation) return fail("forbidden", violation);
  }
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "finance:read");
  if (denied) return fail("forbidden", denied);
  const payment = accessiblePayments(db, user).find((p) => p.id === paymentId);
  if (!payment) return fail("not_found", "سجل الأتعاب غير موجود أو غير مصرّح لك به.");
  if (!text.trim()) return fail("validation", "نص التذكير فارغ.");
  const draft = { id: newId("draft"), kind: "payment-reminder" as const, paymentId, text, createdAt: new Date().toISOString(), createdBy: user.id };
  const result = commit((d) =>
    audit({ ...d, drafts: [draft, ...d.drafts] }, {
      action: "payment-reminder.draft", entityType: "payment", entityId: paymentId,
      summary: `حفظ مسودة تذكير بالدفع للقضية ${payment.caseRef}`, via,
    }),
  );
  return persisted(result, null);
}

// ——— Briefs ———

export function saveBrief(brief: Brief): ApiResult<Brief> {
  const db = getDB();
  const user = currentUser(db);
  if (!findAccessibleCase(brief.caseId, db, user)) return fail("not_found", "القضية غير متاحة.");
  const stamped = { ...brief, updatedAt: new Date().toISOString() };
  const exists = db.briefs.some((b) => b.id === brief.id);
  const result = commit((d) =>
    audit({ ...d, briefs: exists ? d.briefs.map((b) => (b.id === brief.id ? stamped : b)) : [stamped, ...d.briefs] }, {
      action: exists ? "brief.update" : "brief.create", entityType: "brief", entityId: brief.id,
      summary: exists ? "تحديث مسودة مذكرة تحضيرية" : "حفظ مسودة مذكرة تحضيرية", via: "assistant",
    }),
  );
  return persisted(result, stamped);
}

export function deleteBrief(id: string): ApiResult<null> {
  const result = commit((d) =>
    audit({ ...d, briefs: d.briefs.filter((b) => b.id !== id) }, {
      action: "brief.delete", entityType: "brief", entityId: id, summary: "حذف مسودة مذكرة", via: "manual",
    }),
  );
  return persisted(result, null);
}

// ——— Conversations & preferences ———

export function saveConversation(conversation: Conversation): ApiResult<null> {
  const result = commit((d) => {
    const exists = d.conversations.some((c) => c.id === conversation.id);
    const conversations = exists
      ? d.conversations.map((c) => (c.id === conversation.id ? conversation : c))
      : [conversation, ...d.conversations];
    return { ...d, conversations: conversations.slice(0, 50) };
  });
  return persisted(result, null);
}

export function deleteConversation(id: string): ApiResult<null> {
  return persisted(commit((d) => ({ ...d, conversations: d.conversations.filter((c) => c.id !== id) })), null);
}

export function clearConversations(): ApiResult<null> {
  return persisted(commit((d) => ({ ...d, conversations: [] })), null);
}

export function updatePrefs(patch: Partial<AssistantPrefs>): ApiResult<AssistantPrefs> {
  let prefs: AssistantPrefs = getDB().prefs;
  const result = commit((d) => {
    prefs = { ...d.prefs, ...patch };
    return { ...d, prefs };
  });
  return persisted(result, prefs);
}

/** Demo-only: impersonate another team role to exercise permission rules. */
export function switchDemoUser(userId: string): ApiResult<TeamMember> {
  const member = getMember(userId);
  if (!member) return fail("not_found", "المستخدم غير موجود.");
  const result = commit((d) =>
    audit({ ...d, currentUserId: userId }, {
      action: "session.switch-role", entityType: "user", entityId: userId, summary: "تبديل دور المستخدم (وضع تجريبي)", via: "manual",
    }),
  );
  return persisted(result, member);
}

export function updatePolicy(patch: Partial<import("@/types").OfficePolicy>): ApiResult<import("@/types").OfficePolicy> {
  const db = getDB();
  const user = currentUser(db);
  const denied = requirePermission(user, "policy:manage");
  if (denied) return fail("forbidden", denied);
  let policy = db.policy;
  const result = commit((d) => {
    policy = { ...d.policy, ...patch };
    return audit({ ...d, policy }, {
      action: "policy.update", entityType: "policy", entityId: d.tenantId,
      summary: policy.clerkRequiresLawyerApproval ? "تفعيل: مقترحات الكتبة تتطلب موافقة محامٍ" : "تعطيل: مقترحات الكتبة تتطلب موافقة محامٍ",
      via: "manual",
    });
  });
  return persisted(result, policy);
}
