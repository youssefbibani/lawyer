import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Pencil, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalPanel, type PanelTone } from "@/components/approvals/ApprovalPanel";
import { useDB } from "@/hooks/use-db";
import { getMember } from "@/services/api";
import {
  STATUS_LABELS,
  approveAndExecute,
  approverText,
  canDecide,
  decideOperation,
  editableFields,
  executeOperation,
  reviseOperation,
} from "@/services/approvals";
import { formatArabicDate, formatTime } from "@/lib/formatters";
import type { ApprovalRequest } from "@/types";

export function toneOf(status: ApprovalRequest["status"]): PanelTone {
  if (status === "executed") return "success";
  if (status === "failed" || status === "stale") return "danger";
  if (status === "rejected") return "muted";
  return "pending";
}

const splitDetails = (d: string) => {
  const lines = d.split("\n");
  return { details: lines.filter((l) => !l.startsWith("⚠")).join("\n"), warnings: lines.filter((l) => l.startsWith("⚠")).map((l) => l.replace(/^⚠\s*/, "")) };
};

export function ApprovalRequestCard({ request, compact = false }: { request: ApprovalRequest; compact?: boolean }) {
  const db = useDB();
  const allowed = canDecide(request, db);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>(request.params);
  const fields = editableFields(request.operation);
  const legalCase = db.cases.find((c) => c.id === request.caseId);
  const { details, warnings } = splitDetails(request.details);

  function confirm() {
    const r = request.status === "approved" ? executeOperation(request.id) : approveAndExecute(request.id);
    if (r.ok) toast.success("تمت الموافقة والتنفيذ", { description: r.data.execution?.summary });
    else toast.error(r.error);
  }

  function reject() {
    const r = decideOperation(request.id, "reject", note);
    if (r.ok) {
      toast.success("رُفض الطلب ولم يُنفّذ أي تغيير");
      setRejecting(false);
    } else toast.error(r.error);
  }

  function saveRevision() {
    const r = reviseOperation(request.id, draft);
    if (r.ok) {
      toast.success("حُدّث المقترح — يتطلب موافقة جديدة");
      setEditing(false);
    } else toast.error(r.error);
  }

  const decidable = request.status === "pending" || request.status === "approved";
  const revisable = ["pending", "rejected", "stale", "failed"].includes(request.status) && fields.length > 0;

  return (
    <ApprovalPanel
      title={request.title}
      caseLabel={legalCase ? `${legalCase.client} — ${legalCase.ref}` : undefined}
      details={details}
      warnings={warnings}
      changes={request.changes}
      approver={approverText(request)}
      statusLabel={STATUS_LABELS[request.status]}
      tone={toneOf(request.status)}
      proposedBy={compact ? undefined : `${getMember(request.proposedBy)?.name ?? "؟"} — ${formatArabicDate(request.createdAt.slice(0, 10))} ${formatTime(request.createdAt)}${request.revision > 1 ? ` (مراجعة ${request.revision})` : ""}`}
      viaAssistant={request.proposedVia === "assistant"}
    >
      {request.decision && (
        <p className="text-xs text-muted-foreground">
          {request.decision.kind === "approved" ? "وافق" : "رفض"}: {getMember(request.decision.by)?.name} — {formatTime(request.decision.at)}
          {request.decision.note ? ` — «${request.decision.note}»` : ""}
        </p>
      )}
      {request.execution?.ok && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-success/30 bg-success/10 p-2.5 text-sm text-success" role="status">
          <span className="flex items-start gap-2">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />
            {request.execution.summary}
            <span className="block text-[11px] text-success/80">تم التحقق من الحفظ (قاعدة البيانات المحلية — وضع تجريبي).</span>
          </span>
          {request.execution.href && (
            <Button asChild size="sm" variant="outline">
              <Link to={request.execution.href}>فتح</Link>
            </Button>
          )}
        </div>
      )}
      {request.execution && !request.execution.ok && (
        <p className="flex items-start gap-2 text-sm text-alert" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {request.execution.error}
        </p>
      )}

      {editing && (
        <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`${request.id}-${f.key}`}>{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea id={`${request.id}-${f.key}`} rows={5} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <Input
                  id={`${request.id}-${f.key}`}
                  type={f.type}
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => setDraft({ ...draft, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value || undefined })}
                />
              )}
            </div>
          ))}
          <div className="grid gap-2 xs:grid-cols-2">
            <Button size="sm" onClick={saveRevision}>
              حفظ المقترح المعدّل
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              إلغاء التعديل
            </Button>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
          <Label htmlFor={`${request.id}-note`}>سبب الرفض (اختياري)</Label>
          <Textarea id={`${request.id}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="grid gap-2 xs:grid-cols-2">
            <Button size="sm" variant="destructive" onClick={reject}>
              تأكيد الرفض
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              تراجع
            </Button>
          </div>
        </div>
      )}

      {!editing && !rejecting && (
        <div className="grid gap-2 xs:grid-cols-3">
          {decidable && allowed && (
            <Button onClick={confirm}>
              <CheckCircle2 className="h-4 w-4" />
              تأكيد العملية
            </Button>
          )}
          {revisable && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              تعديل المقترح
            </Button>
          )}
          {request.status === "pending" && allowed && (
            <Button variant="outline" className="text-alert" onClick={() => setRejecting(true)}>
              <X className="h-4 w-4" />
              رفض العملية
            </Button>
          )}
        </div>
      )}
      {decidable && !allowed && <p className="text-xs text-muted-foreground">لا تملك صلاحية البتّ في هذا الطلب. سيظهر للمخوّل في «طلبات الموافقة».</p>}
    </ApprovalPanel>
  );
}
