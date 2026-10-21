/**
 * Archive workflow service ("server" boundary for the archive).
 *
 * Every mutation: authorisation + tenant check → workflow transition check → optimistic
 * concurrency (expectedVersion) → persisted with history + hash-chained audit.
 * Verification and final archiving only run under an approved request (approval gate).
 */
import { z } from "zod";

import type {
  ArchiveBatch,
  ArchiveCategory,
  ArchiveDocument,
  ArchiveItem,
  ArchiveItemState,
  ArchivePage,
  DuplicateMatch,
  ExtractedField,
  ProposedChange,
} from "@/types";
import { getDB, commit, newId, type DemoDatabase } from "@/services/db";
import { accessibleCases, approvalViolation, audit, currentUser, findAccessibleCase, getMember, type ApiResult } from "@/services/api";
import { can, PERMISSION_DENIED_MESSAGES } from "@/services/permissions";
import { CATEGORY_DOC_TYPE, CATEGORY_LABELS, STATE_LABELS, canTransition } from "@/services/archive/workflow";
import { toISODate } from "@/lib/dates";

const fail = <T>(code: "forbidden" | "validation" | "not_found" | "conflict" | "storage", error: string): ApiResult<T> => ({ ok: false, code, error });

function guard(db: DemoDatabase): string | null {
  const user = currentUser(db);
  return can(user, "archive:process") ? null : PERMISSION_DENIED_MESSAGES["archive:process"];
}

// ——— Reads ———

export function accessibleBatches(db: DemoDatabase = getDB()): ArchiveBatch[] {
  if (guard(db)) return [];
  return db.batches.filter((b) => b.tenantId === db.tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function batchItems(batchId: string, db: DemoDatabase = getDB()): ArchiveItem[] {
  if (guard(db)) return [];
  return db.archiveItems.filter((i) => i.batchId === batchId && i.tenantId === db.tenantId);
}

export function findItem(itemId: string | undefined, db: DemoDatabase = getDB()): ArchiveItem | undefined {
  if (!itemId || guard(db)) return undefined;
  return db.archiveItems.find((i) => i.id === itemId && i.tenantId === db.tenantId);
}

export function nextBatchReference(db: DemoDatabase = getDB(), now = new Date()): string {
  const year = now.getFullYear();
  const n = db.batches.filter((b) => b.reference.startsWith(`ARC-${year}-`)).length + 1;
  let ref = `ARC-${year}-${String(n).padStart(4, "0")}`;
  let k = n;
  while (db.batches.some((b) => b.reference === ref)) ref = `ARC-${year}-${String(++k).padStart(4, "0")}`;
  return ref;
}

// ——— Batches ———

const batchInput = z.object({
  name: z.string().trim().min(2, "يرجى إدخال اسم الدفعة"),
  reference: z.string().trim().min(3, "يرجى إدخال مرجع الدفعة"),
  location: z.string().trim().min(2, "يرجى تحديد مكان الحفظ المادي"),
  responsibleId: z.string().min(1, "يرجى اختيار الموظف المسؤول"),
  notes: z.string().optional(),
  expectedCount: z.number().int().positive().max(10000).optional(),
  defaultCaseId: z.string().optional(),
});
export type BatchInput = z.infer<typeof batchInput>;

export function createBatch(input: BatchInput): ApiResult<ArchiveBatch> {
  const db = getDB();
  const denied = guard(db);
  if (denied) return fail("forbidden", denied);
  const parsed = batchInput.safeParse(input);
  if (!parsed.success) return fail("validation", parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
  if (db.batches.some((b) => b.reference === parsed.data.reference)) return fail("conflict", "مرجع الدفعة مستعمل مسبقاً.");
  if (!getMember(parsed.data.responsibleId)) return fail("validation", "الموظف المسؤول غير موجود.");
  if (parsed.data.defaultCaseId && !findAccessibleCase(parsed.data.defaultCaseId, db)) return fail("not_found", "القضية غير متاحة.");
  const now = new Date().toISOString();
  const batch: ArchiveBatch = { id: newId("batch"), tenantId: db.tenantId, ...parsed.data, status: "draft", createdAt: now, createdBy: db.currentUserId, updatedAt: now };
  const r = commit((d) =>
    audit({ ...d, batches: [batch, ...d.batches] }, {
      action: "archive.batch.create", entityType: "batch", entityId: batch.id, summary: `إنشاء دفعة أرشفة ${batch.reference}`, via: "manual",
    }),
  );
  return r.ok ? { ok: true, data: batch } : fail("storage", r.error);
}

export function updateBatch(id: string, patch: Partial<BatchInput>): ApiResult<ArchiveBatch> {
  const db = getDB();
  const denied = guard(db);
  if (denied) return fail("forbidden", denied);
  const batch = db.batches.find((b) => b.id === id && b.tenantId === db.tenantId);
  if (!batch) return fail("not_found", "الدفعة غير موجودة.");
  const parsed = batchInput.partial().safeParse(patch);
  if (!parsed.success) return fail("validation", parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
  if (parsed.data.reference && db.batches.some((b) => b.id !== id && b.reference === parsed.data.reference)) return fail("conflict", "مرجع الدفعة مستعمل مسبقاً.");
  const updated = { ...batch, ...parsed.data, updatedAt: new Date().toISOString() };
  const r = commit((d) =>
    audit({ ...d, batches: d.batches.map((b) => (b.id === id ? updated : b)) }, {
      action: "archive.batch.update", entityType: "batch", entityId: id, summary: `تعديل بيانات الدفعة ${updated.reference}`, via: "manual",
    }),
  );
  return r.ok ? { ok: true, data: updated } : fail("storage", r.error);
}

function touchBatch(d: DemoDatabase, batchId: string): DemoDatabase {
  const items = d.archiveItems.filter((i) => i.batchId === batchId);
  const status: ArchiveBatch["status"] =
    items.length === 0 ? "draft" : items.every((i) => i.state === "archived" || i.excluded) ? "completed" : "in_progress";
  return { ...d, batches: d.batches.map((b) => (b.id === batchId ? { ...b, status, updatedAt: new Date().toISOString() } : b)) };
}

// ——— Items ———

export function createItem(batchId: string, file: { name: string; type: string; size: number }): ApiResult<ArchiveItem> {
  const db = getDB();
  const denied = guard(db);
  if (denied) return fail("forbidden", denied);
  const batch = db.batches.find((b) => b.id === batchId && b.tenantId === db.tenantId);
  if (!batch) return fail("not_found", "الدفعة غير موجودة.");
  const now = new Date().toISOString();
  const item: ArchiveItem = {
    id: newId("item"),
    tenantId: db.tenantId,
    batchId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    pages: [],
    state: "draft",
    version: 1,
    fields: [],
    duplicates: [],
    caseMatch: { suggestions: [], decision: batch.defaultCaseId ? "pending" : "pending", caseId: batch.defaultCaseId },
    createdAt: now,
    createdBy: db.currentUserId,
    updatedAt: now,
    history: [{ at: now, by: db.currentUserId, action: "إضافة الوثيقة إلى الدفعة", to: "draft" }],
  };
  const r = commit((d) => touchBatch({ ...d, archiveItems: [...d.archiveItems, item] }, batchId));
  return r.ok ? { ok: true, data: item } : fail("storage", r.error);
}

interface MutateOptions {
  expectedVersion?: number;
  action: string;
  to?: ArchiveItemState;
  note?: string;
  changes?: ProposedChange[];
  /** Pipeline/system updates (progress, OCR results) are not individually audited. */
  system?: boolean;
  allowArchived?: boolean;
}

/** Single entry point for item changes: transition rules, concurrency and history. */
export function mutateItem(itemId: string, opts: MutateOptions, mutator: (item: ArchiveItem) => ArchiveItem = (i) => i): ApiResult<ArchiveItem> {
  const db = getDB();
  const denied = guard(db);
  if (denied) return fail("forbidden", denied);
  const item = findItem(itemId, db);
  if (!item) return fail("not_found", "الوثيقة غير موجودة.");
  if (item.state === "archived" && !opts.allowArchived) return fail("conflict", "الوثائق المؤرشفة نهائياً غير قابلة للتعديل.");
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== item.version) {
    return fail("conflict", "عدّل مستخدم آخر هذه الوثيقة في الأثناء. أعد تحميلها قبل الحفظ حتى لا تُفقد تعديلاته.");
  }
  if (opts.to && opts.to !== item.state && !canTransition(item.state, opts.to)) {
    return fail("validation", `انتقال غير مسموح: من «${STATE_LABELS[item.state]}» إلى «${STATE_LABELS[opts.to]}».`);
  }
  const now = new Date().toISOString();
  const next: ArchiveItem = {
    ...mutator(item),
    state: opts.to ?? item.state,
    version: item.version + 1,
    updatedAt: now,
  };
  if (!opts.system || opts.to) {
    next.history = [...next.history, { at: now, by: db.currentUserId, action: opts.action, from: opts.to ? item.state : undefined, to: opts.to, note: opts.note, changes: opts.changes }];
  }
  const r = commit((d) => {
    let out: DemoDatabase = touchBatch({ ...d, archiveItems: d.archiveItems.map((i) => (i.id === itemId ? next : i)) }, item.batchId);
    if (!opts.system || opts.to) {
      out = audit(out, {
        action: `archive.item.${opts.to ?? "update"}`,
        entityType: "archive-item",
        entityId: itemId,
        summary: `${opts.action} — ${item.fileName}${opts.to ? ` (${STATE_LABELS[item.state]} ← ${STATE_LABELS[opts.to]})` : ""}`,
        via: "manual",
        details: opts.changes ? { changes: opts.changes } : undefined,
      });
    }
    return out;
  });
  return r.ok ? { ok: true, data: next } : fail("storage", r.error);
}

// ——— Human review operations ———

export interface ReviewPatch {
  fields?: ExtractedField[];
  corrected?: Record<string, string>;
  category?: ArchiveCategory;
}

export function saveReview(itemId: string, expectedVersion: number, patch: ReviewPatch): ApiResult<ArchiveItem> {
  const item = findItem(itemId);
  if (!item) return fail("not_found", "الوثيقة غير موجودة.");
  if (item.state === "pending_approval") return fail("conflict", "الوثيقة في انتظار الموافقة: اسحب الطلب قبل التعديل.");
  if (!["review", "needs_correction", "ready"].includes(item.state)) return fail("validation", "لا يمكن تعديل الوثيقة في حالتها الحالية.");
  const changes: ProposedChange[] = [];
  for (const f of patch.fields ?? []) {
    const old = item.fields.find((x) => x.key === f.key);
    if (old?.value !== f.value) changes.push({ label: f.label, before: old?.value, after: f.value });
  }
  for (const [pageId, text] of Object.entries(patch.corrected ?? {})) {
    const page = item.pages.find((p) => p.id === pageId);
    if (page && (page.correctedText ?? page.ocr?.text) !== text) changes.push({ label: `تصحيح نص الصفحة ${page.index + 1}`, after: `${text.length} حرفاً` });
  }
  const finalCat = patch.category;
  if (finalCat && finalCat !== (item.classification?.final ?? item.classification?.suggested)) {
    changes.push({ label: "التصنيف", before: item.classification ? CATEGORY_LABELS[item.classification.final ?? item.classification.suggested] : undefined, after: CATEGORY_LABELS[finalCat] });
  }
  const user = currentUser();
  return mutateItem(
    itemId,
    { expectedVersion, action: "حفظ المراجعة البشرية", changes, to: item.state === "ready" ? "review" : undefined },
    (i) => ({
      ...i,
      fields: patch.fields
        ? patch.fields.map((f) => {
            const old = i.fields.find((x) => x.key === f.key);
            return old?.value === f.value ? { ...old, ...f, source: old.source } : { ...f, source: "human" as const, confidence: 100 };
          })
        : i.fields,
      pages: i.pages.map((p) => (patch.corrected && patch.corrected[p.id] !== undefined && patch.corrected[p.id] !== p.ocr?.text ? { ...p, correctedText: patch.corrected[p.id] } : p)),
      classification:
        finalCat && i.classification
          ? { ...i.classification, final: finalCat, overriddenBy: finalCat !== i.classification.suggested ? user.id : undefined }
          : i.classification,
      review: { reviewerId: user.id, at: new Date().toISOString() },
    }),
  );
}

export function returnForCorrection(itemId: string, expectedVersion: number, reason: string): ApiResult<ArchiveItem> {
  if (!reason.trim()) return fail("validation", "يرجى توضيح سبب الإرجاع.");
  return mutateItem(itemId, { expectedVersion, action: "إرجاع للتصحيح", to: "needs_correction", note: reason.trim() }, (i) => ({
    ...i,
    review: { reviewerId: currentUser().id, at: new Date().toISOString(), returnReason: reason.trim() },
  }));
}

export function resubmitItem(itemId: string, expectedVersion: number): ApiResult<ArchiveItem> {
  return mutateItem(itemId, { expectedVersion, action: "إعادة التقديم للمراجعة بعد التصحيح", to: "review" });
}

export function setCaseDecision(itemId: string, expectedVersion: number, decision: ArchiveItem["caseMatch"]["decision"], caseId?: string): ApiResult<ArchiveItem> {
  if (caseId && !findAccessibleCase(caseId)) return fail("not_found", "القضية غير متاحة.");
  if (decision === "approved" && !caseId) return fail("validation", "اختر القضية قبل اعتماد الربط.");
  const item = findItem(itemId);
  if (item?.state === "pending_approval") return fail("conflict", "الوثيقة في انتظار الموافقة: اسحب الطلب قبل التعديل.");
  const label = { pending: "قيد النظر", approved: "اقتراح ربط معتمد للمراجعة", rejected: "رفض الاقتراح", deferred: "تأجيل الربط" }[decision];
  return mutateItem(
    itemId,
    {
      expectedVersion,
      action: "قرار ربط بالقضية",
      changes: [{ label: "ربط بالقضية", after: `${label}${caseId ? ` — ${getDB().cases.find((c) => c.id === caseId)?.client}` : ""}` }],
    },
    (i) => ({ ...i, caseMatch: { ...i.caseMatch, decision, caseId: decision === "rejected" ? undefined : caseId, decidedBy: currentUser().id } }),
  );
}

export function setDuplicateDecision(itemId: string, targetId: string, decision: DuplicateMatch["decision"]): ApiResult<ArchiveItem> {
  return mutateItem(itemId, { action: decision === "duplicate" ? "تأكيد أنها نسخة مكررة" : "تأكيد أنها ليست نسخة مكررة", note: targetId }, (i) => ({
    ...i,
    duplicates: i.duplicates.map((d) => (d.targetId === targetId ? { ...d, decision } : d)),
    excluded:
      decision === "duplicate"
        ? { reason: "نسخة مكررة — مستبعدة من الأرشفة (الأصل محفوظ)", by: currentUser().id, at: new Date().toISOString() }
        : i.excluded,
  }));
}

export function setExcluded(itemId: string, excluded: boolean, reason = ""): ApiResult<ArchiveItem> {
  return mutateItem(itemId, { action: excluded ? "استبعاد من الأرشفة" : "إعادة إدراج في الأرشفة", note: reason }, (i) => ({
    ...i,
    excluded: excluded ? { reason: reason || "مستبعدة يدوياً", by: currentUser().id, at: new Date().toISOString() } : undefined,
  }));
}

/** Page edits. Rotation/replacement invalidate that page's OCR and send the item back to extraction. */
export function editPages(
  itemId: string,
  expectedVersion: number,
  op:
    | { type: "move"; pageId: string; delta: -1 | 1 }
    | { type: "rotate"; pageId: string }
    | { type: "replace"; pageId: string; originalKey: string; thumbKey: string; width: number; height: number; quality: ArchivePage["quality"] },
): ApiResult<ArchiveItem> {
  const item = findItem(itemId);
  if (!item) return fail("not_found", "الوثيقة غير موجودة.");
  if (!["review", "needs_correction", "failed"].includes(item.state)) return fail("validation", "تعديل الصفحات متاح بعد انتهاء المعالجة الأولية.");
  const invalidates = op.type !== "move";
  const to: ArchiveItemState | undefined = invalidates ? "ocr" : undefined;
  const label = op.type === "move" ? "إعادة ترتيب الصفحات" : op.type === "rotate" ? "تدوير صفحة" : "استبدال صفحة (الأصل القديم محفوظ)";
  return mutateItem(itemId, { expectedVersion, action: label, to }, (i) => {
    let pages = [...i.pages].sort((a, b) => a.index - b.index);
    const idx = pages.findIndex((p) => p.id === op.pageId);
    if (idx < 0) return i;
    if (op.type === "move") {
      const target = idx + op.delta;
      if (target < 0 || target >= pages.length) return i;
      [pages[idx], pages[target]] = [pages[target], pages[idx]];
    } else if (op.type === "rotate") {
      const p = pages[idx];
      pages[idx] = { ...p, rotation: (((p.rotation + 90) % 360) as ArchivePage["rotation"]), ocr: undefined, correctedText: undefined };
    } else {
      const p = pages[idx];
      pages[idx] = {
        ...p,
        replacedKeys: [...(p.replacedKeys ?? []), p.originalKey],
        originalKey: op.originalKey,
        thumbKey: op.thumbKey,
        width: op.width,
        height: op.height,
        quality: op.quality,
        rotation: 0,
        ocr: undefined,
        correctedText: undefined,
      };
    }
    pages = pages.map((p, n) => ({ ...p, index: n }));
    return { ...i, pages };
  });
}

// ——— Gated operations (run only under an approved request) ———

export interface VerifyParams {
  itemId: string;
  expectedVersion: number;
  fields: { key: ExtractedField["key"]; label: string; value: string }[];
  category: ArchiveCategory;
  caseId?: string;
  [key: string]: unknown;
}

export function applyVerification(params: VerifyParams): ApiResult<{ summary: string; entityIds: string[] }> {
  const violation = approvalViolation("archive.verify", params);
  if (violation) return fail("forbidden", violation);
  const item = findItem(params.itemId);
  if (!item) return fail("not_found", "الوثيقة غير موجودة.");
  if (item.version !== params.expectedVersion) return fail("conflict", "تغيّرت الوثيقة بعد تقديم الطلب.");
  const r = mutateItem(params.itemId, { expectedVersion: params.expectedVersion, action: "اعتماد البيانات بعد الموافقة", to: "ready" }, (i) => ({
    ...i,
    fields: i.fields.map((f) => {
      const v = params.fields.find((x) => x.key === f.key);
      return v ? { ...f, value: v.value } : f;
    }),
    classification: i.classification ? { ...i.classification, final: params.category } : { suggested: params.category, confidence: 100, evidence: [], final: params.category },
    caseMatch: { ...i.caseMatch, decision: params.caseId ? "approved" : i.caseMatch.decision === "approved" ? "rejected" : i.caseMatch.decision, caseId: params.caseId },
  }));
  return r.ok ? { ok: true, data: { summary: `اعتُمدت بيانات «${item.fileName}» وأصبحت جاهزة للأرشفة.`, entityIds: [item.id] } } : r;
}

export interface FinalizeParams {
  batchId: string;
  items: { itemId: string; version: number }[];
  [key: string]: unknown;
}

function sizeLabel(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function finalizeItems(params: FinalizeParams): ApiResult<{ summary: string; entityIds: string[]; href: string }> {
  const violation = approvalViolation("archive.finalize", params);
  if (violation) return fail("forbidden", violation);
  const db = getDB();
  const user = currentUser(db);
  const problems: string[] = [];
  const items = params.items.map(({ itemId, version }) => {
    const item = findItem(itemId, db);
    if (!item) problems.push(`وثيقة غير موجودة (${itemId})`);
    else if (item.state !== "ready") problems.push(`«${item.fileName}» ليست جاهزة للأرشفة (${STATE_LABELS[item.state]})`);
    else if (item.version !== version) problems.push(`«${item.fileName}» تغيّرت بعد الموافقة`);
    else if (item.excluded) problems.push(`«${item.fileName}» مستبعدة من الأرشفة`);
    return item!;
  });
  if (problems.length) return fail("conflict", `لم يُحفظ أي شيء: ${problems.join("؛ ")}.`);

  const now = new Date().toISOString();
  const docs: ArchiveDocument[] = [];
  const updatedItems = new Map<string, ArchiveItem>();
  for (const item of items) {
    const field = (k: ExtractedField["key"]) => item.fields.find((f) => f.key === k)?.value;
    const legalCase = item.caseMatch.decision === "approved" && item.caseMatch.caseId ? findAccessibleCase(item.caseMatch.caseId, db, user) : undefined;
    const category = item.classification?.final ?? item.classification?.suggested ?? "other";
    const langs = item.pages.map((p) => p.ocr?.lang);
    const docId = newId("doc");
    docs.push({
      id: docId,
      title: field("title") ?? item.fileName,
      docType: CATEGORY_DOC_TYPE[category],
      caseId: legalCase?.id,
      caseRef: field("caseRef") ?? legalCase?.ref ?? "—",
      client: field("client") ?? legalCase?.client ?? "—",
      date: field("date") ?? toISODate(new Date()),
      size: sizeLabel(item.size),
      source: "archive",
      language: langs.every((l) => l === "fr") ? "fr" : langs.some((l) => l === "fr" || l === "mixed") ? "mixed" : "ar",
      ocrConfidence: Math.round(item.pages.reduce((s, p) => s + (p.ocr?.confidence ?? 0), 0) / Math.max(1, item.pages.length)),
      pages: [...item.pages].sort((a, b) => a.index - b.index).map((p, n) => ({ number: n + 1, text: p.correctedText ?? p.ocr?.text ?? "", lang: p.ocr?.lang === "fr" ? ("fr" as const) : ("ar" as const) })),
      keywords: [CATEGORY_LABELS[category]],
      verified: { reviewerId: item.review?.reviewerId ?? user.id, approvedBy: user.id, at: now, batchId: item.batchId, itemId: item.id, sha256: item.sha256 },
    });
    updatedItems.set(item.id, {
      ...item,
      state: "archived",
      archivedDocumentId: docId,
      version: item.version + 1,
      updatedAt: now,
      history: [...item.history, { at: now, by: user.id, action: "الحفظ النهائي في الأرشيف الموثّق", from: "ready", to: "archived" }],
    });
  }

  // One atomic commit: either every document is archived, or nothing changes.
  const r = commit((d) => {
    let next: DemoDatabase = {
      ...d,
      documents: [...d.documents, ...docs],
      archiveItems: d.archiveItems.map((i) => updatedItems.get(i.id) ?? i),
      cases: d.cases.map((c) => {
        const added = docs.filter((doc) => doc.caseId === c.id).length;
        return added ? { ...c, documents: c.documents + added } : c;
      }),
    };
    for (const doc of docs.filter((x) => x.caseId)) {
      next = { ...next, timeline: [...next.timeline, { id: newId("tl"), caseId: doc.caseId!, date: toISODate(new Date()), title: "أرشفة وثيقة موثّقة", description: `${doc.docType} — ${doc.title}`, icon: "file" as const }] };
    }
    next = touchBatch(next, params.batchId);
    return audit(next, {
      action: "archive.finalize",
      entityType: "batch",
      entityId: params.batchId,
      summary: `أرشفة نهائية لـ${docs.length} وثائق من الدفعة ${d.batches.find((b) => b.id === params.batchId)?.reference ?? ""}`,
      via: "manual",
      details: { result: docs.map((x) => x.id).join(",") },
    });
  });
  if (!r.ok) return fail("storage", r.error);
  // Verify the write before reporting success.
  const saved = getDB().documents.filter((x) => docs.some((d) => d.id === x.id)).length;
  if (saved !== docs.length) return fail("storage", "تعذّر التحقق من حفظ الوثائق.");
  return { ok: true, data: { summary: `تم حفظ ${docs.length} وثائق في الأرشيف الموثّق.`, entityIds: docs.map((x) => x.id), href: `/app/archive/batches/${params.batchId}?step=finalize` } };
}

export function accessibleCasesForMatching(db: DemoDatabase = getDB()) {
  return accessibleCases(db, currentUser(db));
}
