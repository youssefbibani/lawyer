/**
 * Archive operations that require human approval (verification & final archiving).
 * They only create approval requests; execution happens in the approval engine after a decision.
 */
import type { ApprovalRequest } from "@/types";
import { getDB } from "@/services/db";
import type { ApiResult } from "@/services/api";
import { proposeOperation, withdrawOperation } from "@/services/approvals";
import { findItem, mutateItem, type VerifyParams } from "@/services/archive/service";
import { LOW_CONFIDENCE } from "@/services/archive/workflow";

export function uncertainFields(itemId: string) {
  const item = findItem(itemId);
  return (item?.fields ?? []).filter((f) => f.source !== "human" && f.confidence < LOW_CONFIDENCE);
}

export function openRequestFor(itemId: string, operation: "archive.verify" | "archive.finalize" = "archive.verify"): ApprovalRequest | undefined {
  return getDB().approvals.find(
    (a) =>
      a.operation === operation &&
      (a.status === "pending" || a.status === "approved") &&
      (operation === "archive.verify" ? a.params.itemId === itemId : (a.params.items as { itemId: string }[]).some((x) => x.itemId === itemId)),
  );
}

/** Reviewer approves the metadata → item awaits approval (lawyer) → becomes ready once approved. */
export function submitVerification(itemId: string, options: { uncertaintyReviewed: boolean }): ApiResult<ApprovalRequest> {
  const item = findItem(itemId);
  if (!item) return { ok: false, code: "not_found", error: "الوثيقة غير موجودة." };
  if (item.state !== "review") return { ok: false, code: "validation", error: "الاعتماد متاح للوثائق في حالة «في انتظار المراجعة»." };
  if (item.excluded) return { ok: false, code: "validation", error: "الوثيقة مستبعدة من الأرشفة." };
  if (uncertainFields(itemId).length && !options.uncertaintyReviewed) {
    return { ok: false, code: "validation", error: "توجد حقول بثقة منخفضة: راجعها وأكّد ذلك قبل الاعتماد." };
  }
  if (!item.classification) return { ok: false, code: "validation", error: "حدّد تصنيف الوثيقة قبل الاعتماد." };
  const moved = mutateItem(itemId, { expectedVersion: item.version, action: "تقديم البيانات للاعتماد", to: "pending_approval" });
  if (!moved.ok) return moved;
  const params: VerifyParams = {
    itemId,
    expectedVersion: moved.data.version,
    fields: moved.data.fields.map((f) => ({ key: f.key, label: f.label, value: f.value })),
    category: moved.data.classification!.final ?? moved.data.classification!.suggested,
    caseId: moved.data.caseMatch.decision === "approved" ? moved.data.caseMatch.caseId : undefined,
  };
  const proposed = proposeOperation("archive.verify", params, { via: "manual", source: { kind: "archive", batchId: item.batchId, itemIds: [itemId] } });
  if (!proposed.ok) {
    mutateItem(itemId, { action: "تراجع عن التقديم", to: "review", note: proposed.error });
    return proposed;
  }
  return proposed;
}

export function withdrawVerification(itemId: string): ApiResult<ApprovalRequest> {
  const request = openRequestFor(itemId);
  if (!request) {
    const item = findItem(itemId);
    if (item?.state === "pending_approval") {
      const r = mutateItem(itemId, { action: "سحب التقديم", to: "review" });
      return r.ok ? { ok: false, code: "not_found", error: "لا يوجد طلب مفتوح؛ أُعيدت الوثيقة للمراجعة." } : r;
    }
    return { ok: false, code: "not_found", error: "لا يوجد طلب مفتوح لهذه الوثيقة." };
  }
  return withdrawOperation(request.id);
}

export function requestFinalization(batchId: string, itemIds: string[]): ApiResult<ApprovalRequest> {
  const items = itemIds.map((id) => findItem(id)).filter(Boolean);
  if (!items.length) return { ok: false, code: "validation", error: "اختر وثيقة واحدة على الأقل." };
  return proposeOperation(
    "archive.finalize",
    { batchId, items: items.map((i) => ({ itemId: i!.id, version: i!.version })) },
    { via: "manual", source: { kind: "archive", batchId, itemIds } },
  );
}
