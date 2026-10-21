import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, CheckCircle2, Clock, Info, Loader2, Pencil, ShieldAlert, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleCases, accessibleHearings, accessiblePayments, getMember, getTeam } from "@/services/api";
import { ACTION_TITLES, FIELD_LABELS, missingFields } from "@/services/assistant/engine";
import { actionConflicts, actionToOperation } from "@/services/assistant/actions";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { previewOperation, STATUS_LABELS } from "@/services/approvals";
import { approverLabel, approverRolesFor } from "@/services/permissions";
import type { ActionFields, PendingAction } from "@/services/assistant/types";
import { formatArabicDate, formatCurrency } from "@/lib/formatters";
import { weekdayName } from "@/lib/dates";
import type { DemoDatabase } from "@/services/db";

interface ActionCardProps {
  action: PendingAction;
  onChange: (patch: Partial<PendingAction>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<PendingAction["status"], { label: string; className: string }> = {
  draft: { label: "بانتظار تأكيدك", className: "bg-gold/15 text-gold-deep" },
  awaiting_approval: { label: "في انتظار الموافقة", className: "bg-gold/15 text-gold-deep" },
  executing: { label: "جارٍ الحفظ", className: "bg-muted text-muted-foreground" },
  done: { label: "تم الحفظ", className: "bg-success/15 text-success" },
  cancelled: { label: "رُفضت العملية — لم يُحفظ شيء", className: "bg-muted text-muted-foreground" },
  failed: { label: "فشل — لم يُحفظ", className: "bg-alert/15 text-alert" },
};

function day(date?: string) {
  return date ? `${weekdayName(date)} ${formatArabicDate(date)}` : "؟";
}

export function describeAction(action: PendingAction, db: DemoDatabase): string {
  const f = action.fields;
  const c = db.cases.find((x) => x.id === f.caseId);
  const h = db.hearings.find((x) => x.id === f.hearingId);
  const p = db.payments.find((x) => x.id === f.paymentId);
  switch (action.intent) {
    case "create_hearing":
      return `سيتم برمجة ${f.hearingType ?? "جلسة"} لملف ${c?.client ?? "؟"} يوم ${day(f.date)} على الساعة ${f.time ?? "؟"} — ${f.court ?? ""}${f.room ? `، ${f.room}` : ""}.`;
    case "update_hearing":
      return `سيتم نقل ${h?.type ?? "الجلسة"} لملف ${h?.client ?? "؟"} من ${h ? `${day(h.date)} ${h.time}` : "؟"} إلى ${day(f.date)} على الساعة ${f.time ?? "؟"}.`;
    case "create_reminder":
      return `سيتم إنشاء تذكير «${f.title ?? "؟"}» يوم ${day(f.date)} على الساعة ${f.time ?? "؟"}${c ? ` مرتبط بملف ${c.client}` : ""}، للمكلّف ${getMember(f.assigneeId)?.name ?? "؟"}.`;
    case "create_task":
      return `سيتم إنشاء مهمة «${f.title ?? "؟"}» للمكلّف ${getMember(f.assigneeId)?.name ?? "؟"}، موعد الإنجاز ${day(f.date)}${f.time ? ` على الساعة ${f.time}` : ""}${c ? `، مرتبطة بملف ${c.client}` : ""}.`;
    case "draft_payment_reminder":
      return `سيتم حفظ مسودة تذكير بالدفع لـ${p?.client ?? "؟"} (المتبقي ${p ? formatCurrency(p.remaining) : "؟"}) في سجل الأتعاب. لن تُرسل أي رسالة.`;
    case "draft_receipt":
      return `سيتم تسجيل دفعة بمبلغ ${f.amount ? formatCurrency(Number(f.amount)) : "؟"} من ${p?.client ?? "؟"} وإصدار الوصل ${f.receiptNumber ?? ""} بتاريخ ${day(f.date)}، مع أثر في سجل العمليات.`;
  }
}

export function ActionCard({ action, onChange, onConfirm, onCancel }: ActionCardProps) {
  const db = useDB();
  const user = useCurrentUser();
  const f = action.fields;
  const editable = action.status === "draft" || action.status === "failed";
  const missing = missingFields(action);
  const conflicts = useMemo(() => (editable ? actionConflicts(action) : []), [action, editable, db]); // eslint-disable-line react-hooks/exhaustive-deps
  const cases = useMemo(() => accessibleCases(db, user), [db, user]);

  const setField = <K extends keyof ActionFields>(key: K, value: ActionFields[K]) =>
    onChange({ fields: { ...f, [key]: value }, acknowledgedConflicts: false });
  const isMissing = (k: keyof ActionFields) => missing.includes(k);
  const fieldClass = (k: keyof ActionFields) => cn(isMissing(k) && "border-alert ring-1 ring-alert/40");
  const canConfirm = editable && !action.blockedReason && missing.length === 0 && (conflicts.length === 0 || action.acknowledgedConflicts);
  const idp = action.id;
  const [editing, setEditing] = useState(missing.length > 0);

  const caseSelect = (optional: boolean) => (
    <div className="space-y-1">
      <Label htmlFor={`${idp}-case`}>القضية{optional ? " (اختياري)" : ""}</Label>
      <Select value={f.caseId ?? "__none__"} onValueChange={(v) => setField("caseId", v === "__none__" ? undefined : v)} disabled={!editable}>
        <SelectTrigger id={`${idp}-case`} className={fieldClass("caseId")} aria-invalid={isMissing("caseId")}>
          <SelectValue placeholder="اختر القضية" />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value="__none__">بدون قضية</SelectItem>}
          {cases.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.client} — {c.ref}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const dateTime = (timeOptional = false) => (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${idp}-date`}>التاريخ</Label>
        <Input id={`${idp}-date`} type="date" value={f.date ?? ""} onChange={(e) => setField("date", e.target.value || undefined)} disabled={!editable} className={fieldClass("date")} aria-invalid={isMissing("date")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idp}-time`}>الساعة{timeOptional ? " (اختياري)" : ""}</Label>
        <Input id={`${idp}-time`} type="time" value={f.time ?? ""} onChange={(e) => setField("time", e.target.value || undefined)} disabled={!editable} className={fieldClass("time")} aria-invalid={isMissing("time")} />
      </div>
    </div>
  );

  const paymentSelect = () => {
    const list = accessiblePayments(db, user).filter((p) => p.remaining > 0 || p.id === f.paymentId);
    return (
      <div className="space-y-1">
        <Label htmlFor={`${idp}-pay`}>الحريف</Label>
        <Select value={f.paymentId ?? ""} onValueChange={(v) => setField("paymentId", v)} disabled={!editable}>
          <SelectTrigger id={`${idp}-pay`} className={fieldClass("paymentId")} aria-invalid={isMissing("paymentId")}>
            <SelectValue placeholder="اختر الحريف" />
          </SelectTrigger>
          <SelectContent>
            {list.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.client} — المتبقي {formatCurrency(p.remaining)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const request = action.approvalId ? db.approvals.find((a) => a.id === action.approvalId) : undefined;
  const { operation, params } = actionToOperation(action);
  const preview = missing.length === 0 && !action.blockedReason ? previewOperation(operation, params, db) : null;
  const roles = approverRolesFor(operation, db.policy);
  const iCanApprove = roles.includes(user.role);
  const effective = request?.status === "executed" ? "done" : action.status;
  const statusLabel =
    effective === "awaiting_approval" && request
      ? STATUS_LABELS[request.status]
      : effective === "draft"
        ? iCanApprove
          ? "بانتظار تأكيدك"
          : "مسودة — تتطلب موافقة"
        : STATUS_LABEL[effective].label;
  const tone = effective === "done" ? "success" : effective === "failed" || action.blockedReason ? "danger" : effective === "cancelled" ? "muted" : "pending";
  const legalCase = db.cases.find((c) => c.id === f.caseId);
  const resultSummary = action.result?.summary ?? request?.execution?.summary;
  const resultHref = action.result?.href ?? request?.execution?.href;

  return (
    <ApprovalPanel
      title={ACTION_TITLES[action.intent]}
      caseLabel={legalCase ? `${legalCase.client} — ${legalCase.ref}` : undefined}
      details={missing.length === 0 ? describeAction(action, db) : undefined}
      changes={preview?.ok ? preview.preview.changes : []}
      warnings={preview?.ok ? (preview.preview.warnings ?? []).filter((w) => !conflicts.length || !w.startsWith("تعارض")) : []}
      approver={approverLabel(roles)}
      statusLabel={statusLabel}
      tone={tone}
      viaAssistant
    >
      {action.blockedReason ? (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-2.5 text-sm text-alert">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          {action.blockedReason}
        </p>
      ) : (
        <>
          {editing && editable && (
              <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
                {action.intent === "create_hearing" && (
                  <>
                    {caseSelect(false)}
                    {dateTime()}
                    <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${idp}-type`}>نوع الجلسة</Label>
                        <Input id={`${idp}-type`} value={f.hearingType ?? ""} onChange={(e) => setField("hearingType", e.target.value)} disabled={!editable} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${idp}-room`}>القاعة</Label>
                        <Input id={`${idp}-room`} value={f.room ?? ""} onChange={(e) => setField("room", e.target.value)} disabled={!editable} />
                      </div>
                    </div>
                  </>
                )}
  
                {action.intent === "update_hearing" && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`${idp}-hearing`}>الجلسة</Label>
                      <Select value={f.hearingId ?? ""} onValueChange={(v) => setField("hearingId", v)} disabled={!editable}>
                        <SelectTrigger id={`${idp}-hearing`} className={fieldClass("hearingId")} aria-invalid={isMissing("hearingId")}>
                          <SelectValue placeholder="اختر الجلسة" />
                        </SelectTrigger>
                        <SelectContent>
                          {accessibleHearings(db, user).map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.client} — {formatArabicDate(h.date)} {h.time}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {dateTime()}
                  </>
                )}
  
                {(action.intent === "create_reminder" || action.intent === "create_task") && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`${idp}-title`}>العنوان</Label>
                      <Input id={`${idp}-title`} value={f.title ?? ""} onChange={(e) => setField("title", e.target.value)} disabled={!editable} className={fieldClass("title")} aria-invalid={isMissing("title")} />
                    </div>
                    {dateTime(action.intent === "create_task")}
                    <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
                      {caseSelect(true)}
                      <div className="space-y-1">
                        <Label htmlFor={`${idp}-assignee`}>المكلّف</Label>
                        <Select value={f.assigneeId ?? user.id} onValueChange={(v) => setField("assigneeId", v)} disabled={!editable}>
                          <SelectTrigger id={`${idp}-assignee`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getTeam().map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-3">
                      <Label htmlFor={`${idp}-inapp`} className="font-normal">
                        تنبيه داخل التطبيق
                        <span className="block text-[11px] text-muted-foreground">البريد وSMS غير مهيأين في هذه النسخة</span>
                      </Label>
                      <Switch
                        id={`${idp}-inapp`}
                        checked={f.channels?.inApp ?? true}
                        disabled={!editable}
                        onCheckedChange={(v) => setField("channels", { ...(f.channels ?? { email: false, sms: false, inApp: true }), inApp: v })}
                      />
                    </div>
                  </>
                )}
  
                {action.intent === "draft_payment_reminder" && (
                  <>
                    {paymentSelect()}
                    <div className="space-y-1">
                      <Label htmlFor={`${idp}-text`}>نص الرسالة</Label>
                      <Textarea id={`${idp}-text`} rows={6} value={f.text ?? ""} onChange={(e) => setField("text", e.target.value)} disabled={!editable} className={fieldClass("text")} />
                    </div>
                  </>
                )}
  
                {action.intent === "draft_receipt" && (
                  <>
                    {paymentSelect()}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${idp}-amount`}>المبلغ (د.ت)</Label>
                        <Input
                          id={`${idp}-amount`}
                          type="number"
                          inputMode="decimal"
                          step="0.001"
                          value={f.amount ?? ""}
                          onChange={(e) => setField("amount", e.target.value ? Number(e.target.value) : undefined)}
                          disabled={!editable}
                          className={fieldClass("amount")}
                          aria-invalid={isMissing("amount")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${idp}-rdate`}>التاريخ</Label>
                        <Input id={`${idp}-rdate`} type="date" value={f.date ?? ""} onChange={(e) => setField("date", e.target.value)} disabled={!editable} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      رقم الوصل: <span className="font-mono">{f.receiptNumber}</span>
                    </p>
                  </>
                )}
              </div>
            )}

          {action.inferences.length > 0 && action.status !== "done" && (
              <div className="rounded-[var(--radius)] bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  ما استنتجته (تحقّق منه):
                </p>
                <ul className="list-inside list-disc space-y-0.5 leading-6">
                  {action.inferences.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
  
            {action.ambiguities.length > 0 && editable && (
              <ul className="space-y-1 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-2.5 text-xs leading-6 text-gold-deep">
                {action.ambiguities.map((a) => (
                  <li key={a} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
  
            {missing.length > 0 && editable && (
              <p className="text-xs text-alert" role="status">
                حقول مطلوبة: {missing.map((m) => FIELD_LABELS[m]).join("، ")}
              </p>
            )}
  
            {conflicts.length > 0 && editable && (
              <div role="alert" className="space-y-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-2.5 text-xs text-alert">
                <p className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  تعارض في المواعيد
                </p>
                <ul className="list-inside list-disc leading-6">
                  {conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-foreground">
                  <Checkbox checked={!!action.acknowledgedConflicts} onCheckedChange={(v) => onChange({ acknowledgedConflicts: v === true })} />
                  <span>أؤكد المتابعة رغم التعارض</span>
                </label>
              </div>
            )}
        </>
      )}

      {preview && !preview.ok && editable && <p className="text-xs text-alert" role="alert">{preview.error}</p>}

      {effective === "done" && resultSummary && (
        <div className="space-y-2 rounded-[var(--radius)] border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />
            <span>{resultSummary}</span>
          </p>
          <p className="text-xs text-success/80">تم التحقق من الحفظ في قاعدة البيانات المحلية لهذا المتصفح (وضع تجريبي).</p>
          {resultHref && (
            <Button asChild size="sm" variant="outline">
              <Link to={resultHref}>فتح</Link>
            </Button>
          )}
        </div>
      )}

      {effective === "awaiting_approval" && request && (
        <div className="space-y-2 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-3 text-sm text-gold-deep" role="status">
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            {request.status === "pending"
              ? `أُرسل الطلب إلى ${approverLabel(request.approverRoles)}. لن يُنفّذ أي شيء قبل الموافقة.`
              : request.status === "rejected"
                ? `رُفض الطلب${request.decision?.note ? `: «${request.decision.note}»` : "."} لم يُحفظ أي تغيير.`
                : STATUS_LABELS[request.status]}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/approvals">طلبات الموافقة</Link>
          </Button>
        </div>
      )}

      {action.status === "failed" && action.error && (
        <p className="flex items-start gap-2 text-sm text-alert" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {action.error}
        </p>
      )}

      {editable && !action.blockedReason && (
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-3">
          <Button onClick={onConfirm} disabled={!canConfirm}>
            <CheckCircle2 className="h-4 w-4" />
            {iCanApprove ? "تأكيد العملية" : "إرسال للموافقة"}
          </Button>
          <Button variant="outline" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            <Pencil className="h-4 w-4" />
            تعديل المقترح
          </Button>
          <Button variant="outline" className="text-alert" onClick={onCancel}>
            <X className="h-4 w-4" />
            رفض العملية
          </Button>
        </div>
      )}
      {action.status === "executing" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ الحفظ والتحقق...
        </p>
      )}
    </ApprovalPanel>
  );
}
