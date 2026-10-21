/**
 * Centralised human-in-the-loop approval engine.
 *
 * propose → (revise) → decide (approve / reject) → execute → verified result, all audited.
 *
 * Guarantees
 *  - Nothing executes without an explicit human approval by a role allowed by the office policy.
 *    AI proposals are always `proposedVia: "assistant"`; the assistant has no decide/execute path.
 *  - An approval is bound to the exact parameters (SHA-256) and to fingerprints of the records the
 *    operation depends on. Any change → the approval is stale and execution is refused.
 *  - Execution is idempotent: a request executes at most once (status + in-flight guard).
 *  - The data layer refuses gated writes outside runUnderApproval() (no bypass via direct calls).
 */
import { z } from "zod";

import type { ApprovalRequest, LegalCase, OperationType, ProposedChange } from "@/types";
import { commit, getDB, newId, type DemoDatabase } from "@/services/db";
import {
  accessiblePayments,
  audit,
  createHearing,
  createTask,
  currentUser,
  findAccessibleCase,
  findAccessibleDocument,
  findHearingConflicts,
  getMember,
  linkDocumentToCase,
  recordPaymentReceipt,
  runUnderApproval,
  savePaymentReminderDraft,
  updateHearing,
  type ApiResult,
  type HearingInput,
  type TaskInput,
} from "@/services/api";
import { approverLabel, approverRolesFor, can, PROPOSE_PERMISSION, PERMISSION_DENIED_MESSAGES } from "@/services/permissions";
import { applyVerification, finalizeItems, findItem, mutateItem, type FinalizeParams, type VerifyParams } from "@/services/archive/service";
import { CATEGORY_LABELS, STATE_LABELS } from "@/services/archive/workflow";
import { hashValue } from "@/lib/hash";
import { formatArabicDate, formatCurrency } from "@/lib/formatters";
import { weekdayName } from "@/lib/dates";

export const OPERATION_LABELS: Record<OperationType, string> = {
  "hearing.create": "برمجة جلسة",
  "hearing.update": "تعديل موعد جلسة",
  "task.create": "إنشاء مهمة",
  "reminder.create": "إنشاء تذكير",
  "payment.reminder_draft": "حفظ مسودة تذكير بالدفع",
  "receipt.issue": "تسجيل دفعة وإصدار وصل",
  "document.link": "ربط وثيقة بقضية",
  "archive.verify": "اعتماد بيانات وثيقة مؤرشفة",
  "archive.finalize": "الحفظ النهائي في الأرشيف",
};

export const STATUS_LABELS: Record<ApprovalRequest["status"], string> = {
  pending: "في انتظار الموافقة",
  approved: "موافق عليه — لم يُنفّذ بعد",
  rejected: "مرفوض",
  executed: "نُفّذ",
  failed: "تعذّر التنفيذ",
  stale: "متقادم — تغيّرت البيانات",
};

export interface EditableField {
  key: string;
  label: string;
  type: "date" | "time" | "text" | "textarea" | "number";
}

type Preview = { details: string; changes: ProposedChange[]; caseId?: string; warnings?: string[] };
type Outcome = { summary: string; href?: string; entityIds?: string[] };

interface OperationSpec {
  validate(params: Record<string, unknown>, db: DemoDatabase): { ok: true; preview: Preview } | { ok: false; error: string };
  bindings(params: Record<string, unknown>): string[];
  execute(params: Record<string, unknown>): ApiResult<Outcome>;
  editable?: EditableField[];
  onRejected?(request: ApprovalRequest, note?: string): void;
}

const day = (d: string) => `${weekdayName(d)} ${formatArabicDate(d)}`;
const caseOf = (db: DemoDatabase, id?: string): LegalCase | undefined => findAccessibleCase(id, db, currentUser(db));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function wrap<T>(r: ApiResult<T>, map: (data: T) => Outcome): ApiResult<Outcome> {
  return r.ok ? { ok: true, data: map(r.data) } : r;
}

const taskSpec = (kind: "task" | "reminder"): OperationSpec => ({
  validate(p, db) {
    const t = p as unknown as TaskInput;
    if (!t.title?.trim()) return { ok: false, error: "العنوان مطلوب." };
    if (!isoDate.safeParse(t.dueDate).success) return { ok: false, error: "التاريخ غير صالح." };
    if (t.caseId && !caseOf(db, t.caseId)) return { ok: false, error: "القضية غير متاحة." };
    const c = caseOf(db, t.caseId);
    return {
      ok: true,
      preview: {
        caseId: t.caseId,
        details: `${kind === "reminder" ? "تذكير" : "مهمة"} للمكلّف ${getMember(t.assigneeId)?.name ?? "؟"}`,
        changes: [
          { label: "العنوان", after: t.title },
          { label: "الموعد", after: `${day(t.dueDate)}${t.dueTime ? ` — ${t.dueTime}` : ""}` },
          { label: "المكلّف", after: getMember(t.assigneeId)?.name ?? "؟" },
          ...(c ? [{ label: "القضية", after: `${c.client} — ${c.ref}` }] : []),
          { label: "قنوات التنبيه", after: [t.channels.inApp && "داخل التطبيق", t.channels.email && "البريد (غير مهيأ)", t.channels.sms && "SMS (غير مهيأ)"].filter(Boolean).join("، ") || "بدون تنبيه" },
        ],
      },
    };
  },
  bindings: (p) => ((p as unknown as TaskInput).caseId ? [`case:${(p as unknown as TaskInput).caseId}`] : []),
  execute: (p) =>
    wrap(createTask(p as unknown as TaskInput, "assistant"), (t) => ({
      summary: `تم حفظ ${t.kind === "reminder" ? "التذكير" : "المهمة"} «${t.title}» ليوم ${formatArabicDate(t.dueDate)}${t.dueTime ? ` على الساعة ${t.dueTime}` : ""}.`,
      href: `/app/tasks?focus=${t.id}`,
      entityIds: [t.id],
    })),
  editable: [
    { key: "title", label: "العنوان", type: "text" },
    { key: "dueDate", label: "التاريخ", type: "date" },
    { key: "dueTime", label: "الساعة", type: "time" },
  ],
});

const SPECS: Record<OperationType, OperationSpec> = {
  "hearing.create": {
    validate(p, db) {
      const h = p as unknown as HearingInput;
      const c = caseOf(db, h.caseId);
      if (!c) return { ok: false, error: "القضية غير موجودة أو غير مصرّح لك بها." };
      if (!isoDate.safeParse(h.date).success || !hhmm.safeParse(h.time).success) return { ok: false, error: "التاريخ أو الساعة غير صالحين." };
      const conflicts = findHearingConflicts(h.date, h.time, {}, db);
      return {
        ok: true,
        preview: {
          caseId: c.id,
          details: `${h.type} لملف ${c.client}`,
          changes: [
            { label: "التاريخ", after: day(h.date) },
            { label: "الساعة", after: h.time },
            { label: "نوع الجلسة", after: h.type },
            { label: "المحكمة", after: h.court },
            { label: "القاعة", after: h.room },
          ],
          warnings: conflicts.map((x) => `تعارض مع ${x.type} في ملف ${x.client} على الساعة ${x.time}.`),
        },
      };
    },
    bindings: (p) => [`case:${p.caseId}`, `slot:${p.date}`],
    execute: (p) =>
      wrap(createHearing(p as unknown as HearingInput, "assistant"), (h) => ({
        summary: `تمت برمجة ${h.type} لملف ${h.client} يوم ${formatArabicDate(h.date)} على الساعة ${h.time}.`,
        href: `/app/cases/${h.caseId}`,
        entityIds: [h.id],
      })),
    editable: [
      { key: "date", label: "التاريخ", type: "date" },
      { key: "time", label: "الساعة", type: "time" },
      { key: "type", label: "نوع الجلسة", type: "text" },
      { key: "room", label: "القاعة", type: "text" },
    ],
  },
  "hearing.update": {
    validate(p, db) {
      const h = db.hearings.find((x) => x.id === p.hearingId);
      if (!h || !caseOf(db, h.caseId ?? db.cases.find((c) => c.ref === h.caseRef)?.id)) return { ok: false, error: "الجلسة غير متاحة." };
      if (!isoDate.safeParse(p.date).success || !hhmm.safeParse(p.time).success) return { ok: false, error: "الموعد الجديد غير صالح." };
      return {
        ok: true,
        preview: {
          caseId: h.caseId,
          details: `${h.type} — ${h.client}`,
          changes: [
            { label: "التاريخ", before: day(h.date), after: day(String(p.date)) },
            { label: "الساعة", before: h.time, after: String(p.time) },
          ],
          warnings: findHearingConflicts(String(p.date), String(p.time), { excludeId: h.id }, db).map((x) => `تعارض مع ${x.type} في ملف ${x.client}.`),
        },
      };
    },
    bindings: (p) => [`hearing:${p.hearingId}`, `slot:${p.date}`],
    execute: (p) =>
      wrap(updateHearing(String(p.hearingId), { date: String(p.date), time: String(p.time) }, "assistant"), (h) => ({
        summary: `تم نقل ${h.type} لملف ${h.client} إلى ${formatArabicDate(h.date)} على الساعة ${h.time}.`,
        href: "/app/agenda",
        entityIds: [h.id],
      })),
    editable: [
      { key: "date", label: "التاريخ الجديد", type: "date" },
      { key: "time", label: "الساعة الجديدة", type: "time" },
    ],
  },
  "task.create": taskSpec("task"),
  "reminder.create": taskSpec("reminder"),
  "payment.reminder_draft": {
    validate(p, db) {
      const pay = accessiblePayments(db).find((x) => x.id === p.paymentId);
      if (!pay) return { ok: false, error: "سجل الأتعاب غير متاح." };
      if (!String(p.text ?? "").trim()) return { ok: false, error: "نص الرسالة فارغ." };
      return {
        ok: true,
        preview: {
          caseId: db.cases.find((c) => c.ref === pay.caseRef)?.id,
          details: `مسودة رسالة إلى ${pay.client} — لن تُرسل آلياً`,
          changes: [
            { label: "الحريف", after: pay.client },
            { label: "المبلغ المتبقي", after: formatCurrency(pay.remaining) },
            { label: "نص الرسالة", after: String(p.text) },
          ],
        },
      };
    },
    bindings: (p) => [`payment:${p.paymentId}`],
    execute: (p) =>
      wrap(savePaymentReminderDraft(String(p.paymentId), String(p.text), "assistant"), () => ({
        summary: "تم حفظ مسودة التذكير في سجل الأتعاب. لم تُرسل أي رسالة.",
        href: "/app/payments",
      })),
    editable: [{ key: "text", label: "نص الرسالة", type: "textarea" }],
  },
  "receipt.issue": {
    validate(p, db) {
      const pay = accessiblePayments(db).find((x) => x.id === p.paymentId);
      if (!pay) return { ok: false, error: "سجل الأتعاب غير متاح." };
      const amount = Number(p.amount);
      if (!(amount > 0)) return { ok: false, error: "المبلغ غير صالح." };
      if (amount > pay.remaining) return { ok: false, error: `المبلغ يتجاوز المتبقي (${formatCurrency(pay.remaining)}).` };
      return {
        ok: true,
        preview: {
          caseId: db.cases.find((c) => c.ref === pay.caseRef)?.id,
          details: `دفعة من ${pay.client} — وصل ${p.receiptNumber}`,
          changes: [
            { label: "المبلغ المدفوع", before: formatCurrency(pay.paid), after: formatCurrency(pay.paid + amount) },
            { label: "المتبقي", before: formatCurrency(pay.remaining), after: formatCurrency(pay.remaining - amount) },
            { label: "تاريخ الوصل", after: formatArabicDate(String(p.date)) },
          ],
        },
      };
    },
    bindings: (p) => [`payment:${p.paymentId}`],
    execute: (p) =>
      wrap(
        recordPaymentReceipt(
          { paymentId: String(p.paymentId), amount: Number(p.amount), date: String(p.date), receiptNumber: String(p.receiptNumber), notes: p.notes as string | undefined },
          "assistant",
        ),
        (r) => ({ summary: `تم تسجيل الدفعة وإصدار الوصل ${r.receiptNumber} بمبلغ ${formatCurrency(r.amount)}.`, href: `/app/payments?receipt=${r.id}`, entityIds: [r.id] }),
      ),
    editable: [
      { key: "amount", label: "المبلغ", type: "number" },
      { key: "date", label: "التاريخ", type: "date" },
    ],
  },
  "document.link": {
    validate(p, db) {
      const doc = findAccessibleDocument(String(p.documentId), db);
      const c = caseOf(db, String(p.caseId));
      if (!doc || !c) return { ok: false, error: "الوثيقة أو القضية غير متاحة." };
      return { ok: true, preview: { caseId: c.id, details: `${doc.title} (${doc.caseRef})`, changes: [{ label: "ربط بالقضية", after: `${c.client} — ${c.ref}` }] } };
    },
    bindings: (p) => [`document:${p.documentId}`, `case:${p.caseId}`],
    execute: (p) =>
      wrap(linkDocumentToCase(String(p.documentId), String(p.caseId), "assistant"), () => ({ summary: "تم ربط الوثيقة بالقضية.", href: `/app/cases/${p.caseId}` })),
  },
  "archive.verify": {
    validate(p, db) {
      const v = p as unknown as VerifyParams;
      const item = findItem(v.itemId, db);
      if (!item) return { ok: false, error: "الوثيقة غير موجودة." };
      if (item.state !== "pending_approval") return { ok: false, error: `حالة الوثيقة لا تسمح بالاعتماد (${STATE_LABELS[item.state]}).` };
      const c = caseOf(db, v.caseId);
      if (v.caseId && !c) return { ok: false, error: "القضية المقترحة غير متاحة." };
      return {
        ok: true,
        preview: {
          caseId: v.caseId,
          details: `${item.fileName} — ${item.pages.length} صفحات`,
          changes: [
            ...v.fields.map((f) => ({ label: f.label, after: f.key === "date" && isoDate.safeParse(f.value).success ? formatArabicDate(f.value) : f.value || "—" })),
            { label: "التصنيف", after: CATEGORY_LABELS[v.category] },
            { label: "ربط بالقضية", after: c ? `${c.client} — ${c.ref}` : "بدون ربط" },
          ],
          warnings: [
            ...item.duplicates.filter((d) => !d.decision).map((d) => `تكرار محتمل لم يُحسم: ${d.targetLabel}`),
            ...(item.missingPages?.length ? [`صفحات قد تكون ناقصة: ${item.missingPages.join("، ")}`] : []),
          ],
        },
      };
    },
    bindings: (p) => [`archiveItem:${p.itemId}`],
    execute: (p) => wrap(applyVerification(p as VerifyParams), (r) => ({ ...r, href: undefined })),
    onRejected(request, note) {
      const itemId = String(request.params.itemId);
      const item = findItem(itemId);
      if (item?.state === "pending_approval") {
        mutateItem(itemId, { action: "رفض الاعتماد", to: "review", note: note || "رُفض الطلب" }, (i) => ({ ...i, approvalId: undefined }));
      }
    },
  },
  "archive.finalize": {
    validate(p, db) {
      const f = p as unknown as FinalizeParams;
      const batch = db.batches.find((b) => b.id === f.batchId);
      if (!batch) return { ok: false, error: "الدفعة غير موجودة." };
      if (!f.items.length) return { ok: false, error: "لا توجد وثائق جاهزة." };
      const items = f.items.map((x) => findItem(x.itemId, db));
      if (items.some((i) => !i || i.state !== "ready")) return { ok: false, error: "بعض الوثائق ليست في حالة «جاهزة للأرشفة»." };
      return {
        ok: true,
        preview: {
          details: `${f.items.length} وثائق من الدفعة ${batch.reference} — ${batch.name}`,
          changes: items.map((i) => ({
            label: i!.fileName,
            after: `${CATEGORY_LABELS[i!.classification?.final ?? i!.classification?.suggested ?? "other"]}${i!.caseMatch.decision === "approved" && i!.caseMatch.caseId ? ` — ${db.cases.find((c) => c.id === i!.caseMatch.caseId)?.client}` : ""}`,
          })),
        },
      };
    },
    bindings: (p) => (p as unknown as FinalizeParams).items.map((x) => `archiveItem:${x.itemId}`),
    execute: (p) => finalizeItems(p as FinalizeParams),
  },
};

/** Validates and describes an operation without creating a request (used by previews). */
export function previewOperation(operation: OperationType, params: Record<string, unknown>, db: DemoDatabase = getDB()) {
  return SPECS[operation].validate(params, db);
}

export function editableFields(operation: OperationType): EditableField[] {
  return SPECS[operation].editable ?? [];
}

// ——— Fingerprints (record versions an approval depends on) ———

export function fingerprint(key: string, db: DemoDatabase = getDB()): string {
  const [type, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  switch (type) {
    case "case":
      return hashValue(db.cases.find((c) => c.id === id) ?? null);
    case "slot":
      return hashValue(db.hearings.filter((h) => h.date === id).map((h) => [h.id, h.time, h.caseRef]).sort());
    case "hearing":
      return hashValue(db.hearings.find((h) => h.id === id) ?? null);
    case "payment":
      return hashValue(db.payments.find((p) => p.id === id) ?? null);
    case "document": {
      const d = db.documents.find((x) => x.id === id);
      return hashValue(d ? { id: d.id, caseId: d.caseId, links: db.docLinks.filter((l) => l.documentId === id).map((l) => l.caseId) } : null);
    }
    case "archiveItem": {
      const i = db.archiveItems.find((x) => x.id === id);
      return i ? `${i.state}:${i.version}` : "missing";
    }
    default:
      return "unknown";
  }
}

function staleBindings(request: ApprovalRequest, db: DemoDatabase): string[] {
  return request.bindings.filter((b) => fingerprint(b.key, db) !== b.fingerprint).map((b) => b.key);
}

// ——— Engine ———

const fail = <T>(code: "forbidden" | "validation" | "not_found" | "conflict" | "storage", error: string): ApiResult<T> => ({ ok: false, code, error });

export function canDecide(request: ApprovalRequest, db: DemoDatabase = getDB()): boolean {
  const user = currentUser(db);
  return request.approverRoles.includes(user.role);
}

export function approverText(request: ApprovalRequest): string {
  return approverLabel(request.approverRoles);
}

function saveRequest(request: ApprovalRequest, entry: Parameters<typeof audit>[1]): ApiResult<ApprovalRequest> {
  const r = commit((d) => {
    const exists = d.approvals.some((a) => a.id === request.id);
    const approvals = exists ? d.approvals.map((a) => (a.id === request.id ? request : a)) : [request, ...d.approvals];
    return audit({ ...d, approvals }, entry);
  });
  return r.ok ? { ok: true, data: request } : fail("storage", r.error);
}

/** Text summaries for the audit log: long values (letters, OCR text) are reduced to their length. */
function auditChanges(changes: ProposedChange[]): ProposedChange[] {
  const short = (v?: string) => (v && v.length > 80 ? `(${v.length} حرفاً)` : v);
  return changes.map((c) => ({ label: c.label, before: short(c.before), after: short(c.after) ?? "" }));
}

export interface ProposeOptions {
  via: "assistant" | "manual";
  source?: ApprovalRequest["source"];
}

export function proposeOperation(operation: OperationType, params: Record<string, unknown>, options: ProposeOptions): ApiResult<ApprovalRequest> {
  const db = getDB();
  const user = currentUser(db);
  const permission = PROPOSE_PERMISSION[operation];
  if (!can(user, permission)) return fail("forbidden", PERMISSION_DENIED_MESSAGES[permission]);
  const spec = SPECS[operation];
  const v = spec.validate(params, db);
  if (!v.ok) return fail("validation", v.error);
  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    id: newId("apr"),
    tenantId: db.tenantId,
    operation,
    params,
    paramsHash: hashValue(params),
    title: OPERATION_LABELS[operation],
    caseId: v.preview.caseId,
    details: [v.preview.details, ...(v.preview.warnings ?? []).map((w) => `⚠ ${w}`)].join("\n"),
    changes: v.preview.changes,
    proposedBy: user.id,
    proposedVia: options.via,
    createdAt: now,
    updatedAt: now,
    approverRoles: approverRolesFor(operation, db.policy),
    bindings: spec.bindings(params).map((key) => ({ key, fingerprint: fingerprint(key, db) })),
    status: "pending",
    revision: 1,
    source: options.source,
  };
  return saveRequest(request, {
    action: "approval.propose",
    entityType: "approval",
    entityId: request.id,
    summary: `${options.via === "assistant" ? "اقتراح آلي" : "طلب"}: ${request.title} — بانتظار ${approverText(request)}`,
    via: options.via,
    details: { approvalId: request.id, changes: auditChanges(request.changes), paramsHash: request.paramsHash },
  });
}

/** "تعديل المقترح": new parameters → new hash, new bindings, back to pending (any prior approval void). */
export function reviseOperation(id: string, params: Record<string, unknown>): ApiResult<ApprovalRequest> {
  const db = getDB();
  const user = currentUser(db);
  const request = db.approvals.find((a) => a.id === id && a.tenantId === db.tenantId);
  if (!request) return fail("not_found", "الطلب غير موجود.");
  if (request.status === "executed") return fail("conflict", "لا يمكن تعديل طلب نُفّذ.");
  if (request.proposedBy !== user.id && !canDecide(request, db)) return fail("forbidden", "لا يمكنك تعديل هذا الطلب.");
  const spec = SPECS[request.operation];
  const v = spec.validate(params, db);
  if (!v.ok) return fail("validation", v.error);
  const revised: ApprovalRequest = {
    ...request,
    params,
    paramsHash: hashValue(params),
    caseId: v.preview.caseId,
    details: [v.preview.details, ...(v.preview.warnings ?? []).map((w) => `⚠ ${w}`)].join("\n"),
    changes: v.preview.changes,
    bindings: spec.bindings(params).map((key) => ({ key, fingerprint: fingerprint(key, db) })),
    status: "pending",
    decision: undefined,
    execution: undefined,
    revision: request.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  return saveRequest(revised, {
    action: "approval.revise",
    entityType: "approval",
    entityId: id,
    summary: `تعديل المقترح (المراجعة ${revised.revision}): ${revised.title}`,
    via: "manual",
    details: { approvalId: id, changes: auditChanges(revised.changes), paramsHash: revised.paramsHash },
  });
}

export function decideOperation(id: string, decision: "approve" | "reject", note?: string): ApiResult<ApprovalRequest> {
  const db = getDB();
  const user = currentUser(db);
  const request = db.approvals.find((a) => a.id === id && a.tenantId === db.tenantId);
  if (!request) return fail("not_found", "الطلب غير موجود.");
  if (request.status !== "pending") return fail("conflict", `لا يمكن البتّ في طلب حالته «${STATUS_LABELS[request.status]}».`);
  if (!canDecide(request, db)) return fail("forbidden", `ليست لديك صلاحية البتّ في هذا الطلب. المخوّل: ${approverText(request)}.`);
  const now = new Date().toISOString();
  if (decision === "approve") {
    const stale = staleBindings(request, db);
    if (stale.length) {
      const updated = { ...request, status: "stale" as const, updatedAt: now };
      saveRequest(updated, {
        action: "approval.stale", entityType: "approval", entityId: id, via: "manual",
        summary: `رفض موافقة متقادمة: تغيّرت البيانات منذ تقديم الطلب (${request.title})`,
        details: { approvalId: id, result: stale.join(",") },
      });
      return fail("conflict", "تغيّرت البيانات المرتبطة بهذا الطلب منذ تقديمه. راجع المقترح وأعد تقديمه.");
    }
  }
  const updated: ApprovalRequest = {
    ...request,
    status: decision === "approve" ? "approved" : "rejected",
    decision: { kind: decision === "approve" ? "approved" : "rejected", by: user.id, at: now, note: note?.trim() || undefined, paramsHash: request.paramsHash },
    updatedAt: now,
  };
  const r = saveRequest(updated, {
    action: decision === "approve" ? "approval.approve" : "approval.reject",
    entityType: "approval",
    entityId: id,
    summary: `${decision === "approve" ? "موافقة على" : "رفض"}: ${request.title}${note ? " (مع ملاحظة)" : ""}`,
    via: "manual",
    details: { approvalId: id, decision: decision === "approve" ? "approved" : "rejected", paramsHash: request.paramsHash },
  });
  if (r.ok && decision === "reject") SPECS[request.operation].onRejected?.(updated, note);
  return r;
}

const inFlight = new Set<string>();

export function executeOperation(id: string): ApiResult<ApprovalRequest> {
  const db = getDB();
  const request = db.approvals.find((a) => a.id === id && a.tenantId === db.tenantId);
  if (!request) return fail("not_found", "الطلب غير موجود.");
  if (request.status === "executed") return fail("conflict", "نُفّذ هذا الطلب سابقاً؛ لم يُعَد تنفيذه.");
  if (inFlight.has(id)) return fail("conflict", "التنفيذ جارٍ بالفعل.");
  if (request.status !== "approved" || !request.decision || request.decision.kind !== "approved") {
    return fail("forbidden", "لا يمكن التنفيذ دون موافقة صريحة من شخص مخوّل.");
  }
  if (request.decision.paramsHash !== request.paramsHash || hashValue(request.params) !== request.paramsHash) {
    return fail("forbidden", "معطيات الطلب لا تطابق ما تمت الموافقة عليه.");
  }
  if (!canDecide(request, db)) return fail("forbidden", "التنفيذ مقصور على الأشخاص المخوّلين بالموافقة.");
  const stale = staleBindings(request, db);
  const now = () => new Date().toISOString();
  if (stale.length) {
    saveRequest({ ...request, status: "stale", updatedAt: now() }, {
      action: "approval.stale", entityType: "approval", entityId: id, via: "manual",
      summary: `إلغاء تنفيذ موافقة متقادمة (${request.title})`, details: { approvalId: id, result: stale.join(",") },
    });
    return fail("conflict", "تغيّرت البيانات المرتبطة منذ الموافقة. أعد مراجعة المقترح.");
  }

  inFlight.add(id);
  let outcome: ApiResult<Outcome>;
  try {
    outcome = runUnderApproval(id, () => SPECS[request.operation].execute(request.params));
  } catch (err) {
    outcome = fail("storage", err instanceof Error ? err.message : String(err));
  } finally {
    inFlight.delete(id);
  }
  const latest = getDB().approvals.find((a) => a.id === id) ?? request;
  const finished: ApprovalRequest = {
    ...latest,
    status: outcome.ok ? "executed" : "failed",
    execution: outcome.ok
      ? { at: now(), ok: true, summary: outcome.data.summary, href: outcome.data.href, entityIds: outcome.data.entityIds }
      : { at: now(), ok: false, error: outcome.error },
    updatedAt: now(),
  };
  const saved = saveRequest(finished, {
    action: outcome.ok ? "approval.execute" : "approval.execute_failed",
    entityType: "approval",
    entityId: id,
    summary: `${outcome.ok ? "تنفيذ" : "فشل تنفيذ"}: ${request.title}`,
    via: "manual",
    details: { approvalId: id, result: outcome.ok ? (outcome.data.entityIds ?? []).join(",") || "ok" : outcome.error },
  });
  if (!saved.ok) return saved;
  return outcome.ok ? saved : fail(outcome.code, outcome.error);
}

/** "تأكيد العملية" by an authorised human: approve then execute, as one explicit action. */
export function approveAndExecute(id: string, note?: string): ApiResult<ApprovalRequest> {
  const decided = decideOperation(id, "approve", note);
  if (!decided.ok) return decided;
  return executeOperation(id);
}

/** Withdraws a pending request (by its proposer), e.g. to edit an archive item again. */
export function withdrawOperation(id: string): ApiResult<ApprovalRequest> {
  const db = getDB();
  const user = currentUser(db);
  const request = db.approvals.find((a) => a.id === id && a.tenantId === db.tenantId);
  if (!request) return fail("not_found", "الطلب غير موجود.");
  if (request.status !== "pending") return fail("conflict", "يمكن سحب الطلبات المعلّقة فقط.");
  if (request.proposedBy !== user.id && !canDecide(request, db)) return fail("forbidden", "لا يمكنك سحب هذا الطلب.");
  const r = saveRequest({ ...request, status: "rejected", decision: { kind: "rejected", by: user.id, at: new Date().toISOString(), note: "سُحب الطلب من طرف مقدّمه", paramsHash: request.paramsHash } }, {
    action: "approval.withdraw", entityType: "approval", entityId: id, via: "manual", summary: `سحب الطلب: ${request.title}`, details: { approvalId: id },
  });
  if (r.ok) SPECS[request.operation].onRejected?.(r.data, "سُحب الطلب للتعديل");
  return r;
}

export function pendingForMe(db: DemoDatabase = getDB()): ApprovalRequest[] {
  return db.approvals.filter((a) => a.tenantId === db.tenantId && a.status === "pending" && canDecide(a, db));
}
