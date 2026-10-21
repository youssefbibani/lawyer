/**
 * Bridge between assistant previews and the approval engine.
 *
 * A PendingAction (prepared by the engine from the user's words) becomes an ApprovalRequest.
 * - If the current human is an authorised approver, "تأكيد العملية" approves and executes it in
 *   one explicit action.
 * - Otherwise (e.g. a clerk under the office policy) the request waits in «طلبات الموافقة».
 * The assistant itself never approves or executes anything.
 */
import type { OperationType } from "@/types";
import { formatArabicDate } from "@/lib/formatters";
import { findHearingConflicts, findTaskConflicts, getMember, type ApiResult, type TaskInput } from "@/services/api";
import { approveAndExecute, canDecide, proposeOperation } from "@/services/approvals";
import { getDB } from "@/services/db";
import { missingFields } from "@/services/assistant/engine";
import type { PendingAction } from "@/services/assistant/types";

export interface ActionOutcome {
  entityId: string;
  href: string;
  summary: string;
}

/** Conflicts shown in the preview; the user must acknowledge them before confirming. */
export function actionConflicts(action: PendingAction): string[] {
  const f = action.fields;
  if ((action.intent === "create_hearing" || action.intent === "update_hearing") && f.date && f.time) {
    return findHearingConflicts(f.date, f.time, { excludeId: f.hearingId }).map(
      (h) => `تعارض مع ${h.type} في ملف ${h.client} (${h.caseRef}) يوم ${formatArabicDate(h.date)} على الساعة ${h.time}.`,
    );
  }
  if ((action.intent === "create_task" || action.intent === "create_reminder") && f.date && f.time && f.assigneeId) {
    const { tasks, hearings } = findTaskConflicts({ dueDate: f.date, dueTime: f.time, assigneeId: f.assigneeId });
    return [
      ...hearings.map((h) => `في نفس التوقيت: ${h.type} في ملف ${h.client} (${h.time}).`),
      ...tasks.map((t) => `${getMember(t.assigneeId)?.shortName ?? "المكلّف"} لديه مهمة أخرى في نفس التوقيت: «${t.title}».`),
    ];
  }
  return [];
}

/** Maps an assistant preview to an approval-engine operation with exact parameters. */
export function actionToOperation(action: PendingAction): { operation: OperationType; params: Record<string, unknown> } {
  const f = action.fields;
  switch (action.intent) {
    case "create_hearing":
      return {
        operation: "hearing.create",
        params: { caseId: f.caseId, date: f.date, time: f.time, court: f.court || "قصر العدالة بتونس", room: f.room || "تُحدَّد لاحقاً", type: f.hearingType || "جلسة استماع" },
      };
    case "update_hearing":
      return { operation: "hearing.update", params: { hearingId: f.hearingId, date: f.date, time: f.time } };
    case "create_reminder":
    case "create_task": {
      const task: TaskInput = {
        kind: action.intent === "create_reminder" ? "reminder" : "task",
        title: f.title ?? "",
        caseId: f.caseId,
        hearingId: f.hearingId,
        assigneeId: f.assigneeId ?? getDB().currentUserId,
        dueDate: f.date ?? "",
        dueTime: f.time || undefined,
        priority: f.priority ?? "medium",
        channels: f.channels ?? { inApp: true, email: false, sms: false },
        recurrence: f.recurrence ?? "none",
      };
      return { operation: action.intent === "create_reminder" ? "reminder.create" : "task.create", params: task as unknown as Record<string, unknown> };
    }
    case "draft_payment_reminder":
      return { operation: "payment.reminder_draft", params: { paymentId: f.paymentId, text: f.text } };
    case "draft_receipt":
      return { operation: "receipt.issue", params: { paymentId: f.paymentId, amount: Number(f.amount), date: f.date, receiptNumber: f.receiptNumber, notes: f.text } };
  }
}

export type SubmitOutcome =
  | { kind: "executed"; approvalId: string; outcome: ActionOutcome }
  | { kind: "awaiting"; approvalId: string };

/**
 * Called only from the explicit "تأكيد العملية" button. Creates the approval request and, when the
 * current human may approve it, approves + executes it immediately.
 */
export function submitAction(action: PendingAction, conversationId?: string): ApiResult<SubmitOutcome> {
  if (action.status !== "draft" && action.status !== "failed") return { ok: false, code: "validation", error: "تمت معالجة هذا الإجراء مسبقاً." };
  if (action.blockedReason) return { ok: false, code: "forbidden", error: action.blockedReason };
  if (missingFields(action).length) return { ok: false, code: "validation", error: "توجد حقول ناقصة يجب إكمالها قبل التأكيد." };
  if (actionConflicts(action).length && !action.acknowledgedConflicts) {
    return { ok: false, code: "conflict", error: "يوجد تعارض في المواعيد: يجب الإقرار به قبل التأكيد." };
  }
  const { operation, params } = actionToOperation(action);
  const proposed = proposeOperation(operation, params, { via: "assistant", source: { kind: "assistant", conversationId } });
  if (!proposed.ok) return proposed;
  if (!canDecide(proposed.data)) return { ok: true, data: { kind: "awaiting", approvalId: proposed.data.id } };
  const executed = approveAndExecute(proposed.data.id);
  if (!executed.ok) return executed;
  const ex = executed.data.execution!;
  return {
    ok: true,
    data: { kind: "executed", approvalId: proposed.data.id, outcome: { entityId: ex.entityIds?.[0] ?? "", href: ex.href ?? "/app/approvals", summary: ex.summary ?? "تم التنفيذ." } },
  };
}

/** Backwards-compatible facade: an explicit confirmation by an authorised human. */
export const actionExecutor = {
  execute(action: PendingAction): ApiResult<ActionOutcome> {
    const r = submitAction(action);
    if (!r.ok) return r;
    if (r.data.kind === "awaiting") return { ok: false, code: "forbidden", error: "أُرسل الطلب للموافقة: لا يملك المستخدم الحالي صلاحية الموافقة." };
    return { ok: true, data: r.data.outcome };
  },
};
