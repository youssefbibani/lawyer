import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, FileWarning, Info, Loader2, Lock, PercentCircle, Plus, Printer, ReceiptText, Send, TrendingUp, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/shared/MetricCard";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { ReceiptPanel } from "@/components/finance/ReceiptPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCompact } from "@/hooks/use-media-query";
import { useDB } from "@/hooks/use-db";
import { copyToClipboard, printElement } from "@/lib/print";
import { formatArabicDate, formatCurrency } from "@/lib/formatters";
import { api, isApiError, newIdempotencyKey } from "@/backend/http";
import { useApiMutation, useCan, useCases, useFee, useFees, useFinanceTotals, useMe } from "@/backend/queries";
import { PAYMENT_METHOD_LABELS, SETTLEMENT_LABELS, settlementTone } from "@/backend/labels";
import { formatMoney, percentOf, todayISO } from "@/backend/format";
import { PAYMENT_METHODS, type FeeAgreementDTO, type PaymentDTO, type PaymentMethod, type ReceiptDTO, type RecordPaymentResultDTO } from "../../shared/api";

interface PaymentForm {
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
}

const MONEY_RE = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;

export default function Payments() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const caseFilter = params.get("case") ?? undefined;
  const can = useCan();
  const { data: me } = useMe();
  const compact = useIsCompact();
  const canRead = can("finance:read");
  const canRecord = can("payment:record");
  const canManage = can("finance:write");

  const fees = useFees({ caseId: caseFilter }, canRead);
  const totals = useFinanceTotals(canRead);
  const agreements = useMemo(() => (fees.data?.items ?? []).filter((a) => a.status !== "CANCELLED"), [fees.data]);

  const [reminderTarget, setReminderTarget] = useState<FeeAgreementDTO | null>(null);
  const [reminderMessage, setReminderMessage] = useState("");
  const [payTarget, setPayTarget] = useState<FeeAgreementDTO | null>(null);
  const [form, setForm] = useState<PaymentForm>({ amount: "", paidOn: todayISO(), method: "CASH", reference: "", notes: "" });
  const [formError, setFormError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<ReceiptDTO | null>(null);
  const [historyId, setHistoryId] = useState<string | undefined>();
  const [newAgreementOpen, setNewAgreementOpen] = useState(false);
  const idempotency = useRef<string>("");

  // Legacy deep link from the demo assistant (local store): /app/payments?receipt=<demo id>.
  const db = useDB();
  const legacyId = params.get("receipt");
  const legacyReceipt = legacyId ? db.receipts.find((r) => r.id === legacyId) : undefined;
  const legacyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (caseFilter && fees.data && fees.data.items.length === 0 && canManage) setNewAgreementOpen(true);
  }, [caseFilter, fees.data, canManage]);

  const record = useApiMutation(
    ({ agreement, values, key }: { agreement: FeeAgreementDTO; values: PaymentForm; key: string }) =>
      api.post<RecordPaymentResultDTO>(
        "/payments",
        { agreementId: agreement.id, amount: values.amount, paidOn: values.paidOn, method: values.method, reference: values.reference.trim() || null, notes: values.notes.trim() || null },
        key,
      ),
    ["finance"],
  );

  if (!canRead) {
    return (
      <AppShell title="الأتعاب والمستحقات" subtitle="متابعة المدفوعات وإصدار الوصولات">
        <EmptyState icon={Lock} title="غير مصرّح" description="ليست لديك صلاحية الاطلاع على البيانات المالية للمكتب." />
      </AppShell>
    );
  }

  const primary = totals.data?.find((t) => t.currency === (me?.office.defaultCurrency ?? "TND")) ?? totals.data?.[0];

  function openReminder(a: FeeAgreementDTO) {
    setReminderTarget(a);
    setReminderMessage(
      `السيد(ة) ${a.client?.fullName ?? ""} المحترم(ة)،\n\nنذكّركم بأن مبلغ ${formatMoney(a.remaining, a.currency)} المتعلق بالقضية ${a.caseReference} لا يزال مستحقاً. نرجو التكرم بتسوية المبلغ في أقرب الآجال.\n\nمع خالص التقدير.`,
    );
  }

  async function copyReminder() {
    const ok = await copyToClipboard(reminderMessage);
    if (ok) toast.success("تم نسخ نص التذكير", { description: "يمكنك لصقه في البريد أو الرسائل." });
    else toast.error("تعذّر النسخ تلقائياً. حدّد النص وانسخه يدوياً.");
  }

  function openPayment(a: FeeAgreementDTO) {
    setPayTarget(a);
    setIssued(null);
    setFormError(undefined);
    setForm({ amount: a.remaining, paidOn: todayISO(), method: "CASH", reference: "", notes: "" });
    // One key per payment intent: a retry after a network failure can never record twice.
    idempotency.current = newIdempotencyKey();
  }

  function validate(): boolean {
    if (!MONEY_RE.test(form.amount.trim()) || Number(form.amount) <= 0) return setFormError("قيمة المبلغ غير صالحة (رقم موجب بثلاثة أرقام عشرية على الأكثر)."), false;
    if (!form.paidOn) return setFormError("يرجى تحديد تاريخ الدفع."), false;
    if ((form.method === "CHECK" || form.method === "BANK_TRANSFER") && !form.reference.trim()) return setFormError("يرجى إدخال مرجع الصك أو التحويل."), false;
    setFormError(undefined);
    return true;
  }

  function submitPayment() {
    if (!payTarget) return;
    setConfirming(false);
    record.mutate(
      { agreement: payTarget, values: { ...form, amount: form.amount.trim() }, key: idempotency.current },
      {
        onSuccess: (r) => {
          setIssued(r.payment.receipt);
          setPayTarget(r.agreement);
          if (r.payment.receipt?.pdf.available) toast.success("تم تسجيل الدفعة وإصدار الوصل", { description: `الوصل ${r.payment.receipt.number}` });
          else toast.warning("تم تسجيل الدفعة وإصدار رقم الوصل، لكن ملف PDF لم يُولَّد", { description: "يمكنك إعادة محاولة التوليد." });
        },
        onError: (err) => {
          setFormError(isApiError(err, "NETWORK") ? `${err.message} يمكنك إعادة المحاولة بأمان: لن تُسجَّل الدفعة مرتين.` : err.message);
          if (isApiError(err, "IDEMPOTENCY_KEY_REUSED")) idempotency.current = newIdempotencyKey();
        },
      },
    );
  }

  const actionsFor = (a: FeeAgreementDTO) => (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" disabled={a.settlement === "PAID"} onClick={() => openReminder(a)}>
        <Send className="h-3.5 w-3.5" />
        تذكير
      </Button>
      <Button size="sm" variant="outline" disabled={a.settlement === "PAID" || !canRecord} onClick={() => openPayment(a)} title={!canRecord ? "يتطلب صلاحية مالية" : undefined}>
        <ReceiptText className="h-3.5 w-3.5" />
        وصل
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setHistoryId(a.id)}>
        عرض السجل
      </Button>
    </div>
  );

  return (
    <AppShell title="الأتعاب والمستحقات" subtitle="متابعة المدفوعات وإصدار الوصولات">
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <MetricCard icon={TrendingUp} value={primary ? formatMoney(primary.paid, primary.currency) : "—"} label="إجمالي المقبوض" />
          <MetricCard icon={Wallet} value={primary ? formatMoney(primary.remaining, primary.currency) : "—"} label="في انتظار الدفع" tone="gold" />
          <MetricCard icon={PercentCircle} value={primary ? `${percentOf(primary.paid, primary.agreed)}%` : "—"} label="نسبة الاستخلاص" />
          <MetricCard icon={FileWarning} value={primary ? String(primary.unsettledCount) : "—"} label="عدد الملفات غير المسددة" tone="alert" />
        </div>
        {(totals.data?.length ?? 0) > 1 && <p className="text-xs text-muted-foreground">المؤشرات أعلاه بعملة {primary?.currency}؛ توجد اتفاقيات بعملات أخرى في السجل.</p>}

        {!canRecord && (
          <p className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            يمكنك الاطلاع على الأتعاب فقط؛ تسجيل الدفعات وإصدار الوصولات يتطلب صلاحية مالية.
          </p>
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg">سجل الأتعاب</h2>
            <div className="flex items-center gap-2">
              {caseFilter && (
                <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
                  <X className="h-4 w-4" />
                  عرض كل الملفات
                </Button>
              )}
              {canManage && (
                <Button size="sm" onClick={() => setNewAgreementOpen(true)}>
                  <Plus className="h-4 w-4" />
                  اتفاق أتعاب جديد
                </Button>
              )}
            </div>
          </div>
          {fees.isPending ? (
            <SkeletonCards count={3} />
          ) : fees.error ? (
            <div role="alert" className="card-elevated space-y-3 p-6 text-center">
              <p className="text-sm text-alert">{fees.error.message}</p>
              <Button variant="outline" onClick={() => void fees.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : agreements.length === 0 ? (
            <EmptyState icon={Wallet} title="لا توجد اتفاقيات أتعاب" description={canManage ? "أضف اتفاق أتعاب لملف لتتمكن من تسجيل الدفعات وإصدار الوصولات." : "لم تُسجَّل أي أتعاب بعد."} />
          ) : compact ? (
            <ul className="space-y-3">
              {agreements.map((a) => (
                <li key={a.id} className="card-elevated space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{a.client?.fullName ?? "—"}</p>
                      <CaseReference value={a.caseReference} className="mt-1" />
                    </div>
                    <StatusBadge label={SETTLEMENT_LABELS[a.settlement]} tone={settlementTone(a.settlement)} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-sm bg-muted/50 p-2">
                      <dt className="text-[11px] text-muted-foreground">المتفق عليه</dt>
                      <dd className="font-mono text-xs">{formatMoney(a.amount, a.currency)}</dd>
                    </div>
                    <div className="rounded-sm bg-muted/50 p-2">
                      <dt className="text-[11px] text-muted-foreground">المدفوع</dt>
                      <dd className="font-mono text-xs text-success">{formatMoney(a.paid, a.currency)}</dd>
                    </div>
                    <div className="rounded-sm bg-muted/50 p-2">
                      <dt className="text-[11px] text-muted-foreground">المتبقي</dt>
                      <dd className="font-mono text-xs text-alert">{formatMoney(a.remaining, a.currency)}</dd>
                    </div>
                  </dl>
                  {a.paymentCount > 0 && <p className="text-xs text-muted-foreground">{a.paymentCount} دفعات مسجّلة</p>}
                  {actionsFor(a)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="card-elevated">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الحريف / القضية</TableHead>
                    <TableHead>المبلغ المتفق عليه</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium">{a.client?.fullName ?? "—"}</p>
                        <CaseReference value={a.caseReference} className="mt-1" />
                        {a.paymentCount > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{a.paymentCount} دفعات</p>}
                      </TableCell>
                      <TableCell className="font-mono">{formatMoney(a.amount, a.currency)}</TableCell>
                      <TableCell className="font-mono text-success">{formatMoney(a.paid, a.currency)}</TableCell>
                      <TableCell className="font-mono text-alert">{formatMoney(a.remaining, a.currency)}</TableCell>
                      <TableCell>
                        <StatusBadge label={SETTLEMENT_LABELS[a.settlement]} tone={settlementTone(a.settlement)} />
                      </TableCell>
                      <TableCell>{actionsFor(a)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Payment reminder text (copy only: no message is sent from here). */}
      <Dialog open={!!reminderTarget} onOpenChange={(open) => !open && setReminderTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعداد تذكير بالدفع</DialogTitle>
            <DialogDescription>راجع نص التذكير ثم انسخه وأرسله بالوسيلة المعتادة.</DialogDescription>
          </DialogHeader>
          {reminderTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">الحريف</p>
                  <p className="font-medium">{reminderTarget.client?.fullName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">القضية</p>
                  <CaseReference value={reminderTarget.caseReference} />
                </div>
                <div>
                  <p className="text-muted-foreground">المبلغ المتبقي</p>
                  <p className="font-mono text-alert">{formatMoney(reminderTarget.remaining, reminderTarget.currency)}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reminder-message">الرسالة</Label>
                <Textarea id="reminder-message" rows={6} value={reminderMessage} onChange={(e) => setReminderMessage(e.target.value)} />
              </div>
              <p className="flex items-start gap-2 rounded-[var(--radius)] border border-gold/30 bg-gold/10 p-3 text-xs text-gold-deep">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                لا تُرسل هذه الصفحة أي رسالة للحريف: انسخ النص وأرسله بالوسيلة المعتادة.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={copyReminder}>
              <Copy className="h-4 w-4" />
              نسخ النص
            </Button>
            <Button variant="ghost" onClick={() => setReminderTarget(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record a payment → receipt */}
      <Dialog
        open={!!payTarget}
        onOpenChange={(open) => {
          if (!open && !record.isPending) {
            setPayTarget(null);
            setIssued(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{issued ? "وصل أتعاب" : "إنشاء وصل أتعاب"}</DialogTitle>
            <DialogDescription>{issued ? "الدفعة مسجّلة والوصل صادر برقم تسلسلي." : "سيتم تسجيل الدفعة وإصدار وصل برقم تسلسلي بعد التأكيد."}</DialogDescription>
          </DialogHeader>

          {payTarget && !issued && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (validate()) setConfirming(true);
              }}
              className="space-y-4"
              noValidate
            >
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">الحريف</p>
                  <p className="font-medium">{payTarget.client?.fullName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">المتبقي المستحق</p>
                  <p className="font-mono text-alert">{formatMoney(payTarget.remaining, payTarget.currency)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-amount">المبلغ المستلم ({payTarget.currency === "TND" ? "د.ت" : payTarget.currency})</Label>
                  <Input id="pay-amount" dir="ltr" inputMode="decimal" className="text-left font-mono" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-date">تاريخ الدفع</Label>
                  <Input id="pay-date" type="date" max={todayISO()} value={form.paidOn} onChange={(e) => setForm((f) => ({ ...f, paidOn: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>طريقة الدفع</Label>
                  <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v as PaymentMethod }))}>
                    <SelectTrigger aria-label="طريقة الدفع">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-ref">المرجع (صك / تحويل)</Label>
                  <Input id="pay-ref" dir="ltr" className="text-left" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-notes">ملاحظات</Label>
                <Textarea id="pay-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={record.isPending}>
                  {record.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {formError && isApiError(record.error, "NETWORK") ? "إعادة المحاولة" : "متابعة"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setPayTarget(null)} disabled={record.isPending}>
                  إلغاء
                </Button>
              </DialogFooter>
            </form>
          )}

          {issued && (
            <div className="space-y-4">
              <ReceiptPanel receipt={issued} onChange={setIssued} />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayTarget(null);
                    setIssued(null);
                  }}
                >
                  إغلاق
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="تأكيد تسجيل الدفعة"
        description={
          payTarget
            ? `سيتم تسجيل دفعة بمبلغ ${formatMoney(form.amount.trim(), payTarget.currency)} من ${payTarget.client?.fullName ?? "الحريف"} (${PAYMENT_METHOD_LABELS[form.method]}) وإصدار وصل برقم تسلسلي. لا يمكن حذف الدفعة بعد تسجيلها، ويمكن فقط إلغاؤها بسبب مكتوب.`
            : ""
        }
        confirmLabel="تسجيل وإصدار الوصل"
        onConfirm={submitPayment}
      />

      <AgreementHistoryDialog id={historyId} onClose={() => setHistoryId(undefined)} onOpenCase={(caseId) => navigate(`/app/cases/${caseId}`)} />
      <NewAgreementDialog open={newAgreementOpen} onOpenChange={setNewAgreementOpen} defaultCaseId={caseFilter} />

      {/* Demo assistant receipts (local store only) — kept readable, clearly labelled. */}
      <Dialog open={!!legacyReceipt} onOpenChange={(o) => !o && setParams({}, { replace: true })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>وصل تجريبي من المساعد</DialogTitle>
            <DialogDescription>هذا الوصل أنشأه المساعد في الوضع التجريبي المحلي، وهو غير مسجّل في سجل الأتعاب على الخادم.</DialogDescription>
          </DialogHeader>
          {legacyReceipt && (
            <div className="space-y-4">
              <div ref={legacyRef} className="print-area rounded-[var(--radius)] border border-border bg-white p-6 font-legal text-ink">
                <p className="mb-2 text-center text-xs text-alert">وصل تجريبي — بلا قيمة إبرائية</p>
                <Separator className="mb-4" />
                <div className="space-y-2 text-sm">
                  <p>
                    وصل عدد: <span className="font-mono" dir="ltr">{legacyReceipt.receiptNumber}</span> — {formatArabicDate(legacyReceipt.date)}
                  </p>
                  <p>الحريف: {legacyReceipt.client}</p>
                  <p>
                    القضية: <span className="font-mono" dir="ltr">{legacyReceipt.caseRef}</span>
                  </p>
                  <p>المبلغ: {formatCurrency(legacyReceipt.amount)}</p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => legacyRef.current && printElement(legacyRef.current, `وصل تجريبي ${legacyReceipt.receiptNumber}`)}>
                  <Printer className="h-4 w-4" />
                  طباعة
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function AgreementHistoryDialog({ id, onClose, onOpenCase }: { id?: string; onClose: () => void; onOpenCase: (caseId: string) => void }) {
  const can = useCan();
  const detail = useFee(id);
  const [voiding, setVoiding] = useState<PaymentDTO | null>(null);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const voidPayment = useApiMutation(({ p, reason }: { p: PaymentDTO; reason: string }) => api.post<PaymentDTO>(`/payments/${p.id}/void`, { reason }), ["finance"]);
  const a = detail.data;

  return (
    <>
      <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>سجل الدفعات</DialogTitle>
            <DialogDescription>
              {a ? (
                <>
                  {a.client?.fullName ?? "—"} — <span dir="ltr">{a.caseReference}</span>
                </>
              ) : (
                "جارٍ التحميل..."
              )}
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <SkeletonCards count={2} />
          ) : detail.error ? (
            <p className="text-sm text-alert">{detail.error.message}</p>
          ) : a ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-sm bg-muted/50 p-2">
                  <p className="text-[11px] text-muted-foreground">المتفق عليه</p>
                  <p className="font-mono">{formatMoney(a.amount, a.currency)}</p>
                </div>
                <div className="rounded-sm bg-muted/50 p-2">
                  <p className="text-[11px] text-muted-foreground">المدفوع</p>
                  <p className="font-mono text-success">{formatMoney(a.paid, a.currency)}</p>
                </div>
                <div className="rounded-sm bg-muted/50 p-2">
                  <p className="text-[11px] text-muted-foreground">المتبقي</p>
                  <p className="font-mono text-alert">{formatMoney(a.remaining, a.currency)}</p>
                </div>
              </div>
              {a.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد دفعات مسجّلة.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {a.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="font-mono">
                          {formatMoney(p.amount, p.currency)} <span className="text-xs text-muted-foreground">— {PAYMENT_METHOD_LABELS[p.method]}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatArabicDate(p.paidOn)} • {p.recordedBy.name}
                          {p.receipt && (
                            <>
                              {" "}
                              • وصل <span dir="ltr">{p.receipt.number}</span>
                            </>
                          )}
                        </p>
                        {p.status === "VOIDED" && <p className="text-xs text-alert">ملغاة: {p.voidReason}</p>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.status === "VOIDED" && <StatusBadge label="ملغاة" tone="alert" />}
                        {p.receipt && (
                          <Button size="sm" variant="outline" onClick={() => setReceipt(p.receipt)}>
                            الوصل
                          </Button>
                        )}
                        {p.status === "RECORDED" && can("payment:void") && (
                          <Button size="sm" variant="ghost" className="text-alert" onClick={() => (setVoiding(p), setReason(""))}>
                            إلغاء الدفعة
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenCase(a.caseId)}>
                  فتح الملف
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء دفعة</DialogTitle>
            <DialogDescription>لا تُحذف الدفعة: تُسجَّل كملغاة مع السبب، ويُلغى وصلها، ويعود المبلغ إلى المتبقي. سجّل الدفعة الصحيحة من جديد عند الحاجة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">سبب الإلغاء</Label>
            <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!reason.trim() || voidPayment.isPending}
              onClick={() =>
                voiding &&
                voidPayment.mutate(
                  { p: voiding, reason: reason.trim() },
                  { onSuccess: () => (toast.success("أُلغيت الدفعة وأُلغي وصلها"), setVoiding(null)), onError: (err) => toast.error(err.message) },
                )
              }
            >
              {voidPayment.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              تأكيد الإلغاء
            </Button>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              رجوع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>وصل أتعاب</DialogTitle>
            <DialogDescription>الوصل كما صدر (لا يتغير بعد إصداره).</DialogDescription>
          </DialogHeader>
          {receipt && <ReceiptPanel receipt={receipt} onChange={setReceipt} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewAgreementDialog({ open, onOpenChange, defaultCaseId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCaseId?: string }) {
  const { data: me } = useMe();
  const cases = useCases({ pageSize: 100, sort: "updatedAt:desc" }, open);
  const [caseId, setCaseId] = useState(defaultCaseId ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(me?.office.defaultCurrency ?? "TND");
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string>();
  const key = useRef("");
  const create = useApiMutation(
    () => api.post<FeeAgreementDTO>("/fees", { caseId, amount: amount.trim(), currency, title: title.trim() || null, paymentTerms: terms.trim() || null }, key.current),
    ["finance"],
  );

  useEffect(() => {
    if (open) {
      // One key per creation intent: a retry after a network error cannot create a duplicate.
      key.current = newIdempotencyKey();
      setCaseId(defaultCaseId ?? "");
      setAmount("");
      setTitle("");
      setTerms("");
      setError(undefined);
    }
  }, [open, defaultCaseId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) return setError("يرجى اختيار الملف");
    if (!MONEY_RE.test(amount.trim()) || Number(amount) <= 0) return setError("قيمة المبلغ غير صالحة");
    create.mutate(undefined, { onSuccess: () => (toast.success("تم تسجيل اتفاق الأتعاب"), onOpenChange(false)), onError: (err) => setError(err.message) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>اتفاق أتعاب جديد</DialogTitle>
          <DialogDescription>المبلغ المتفق عليه مع الحريف لملف معيّن.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label>الملف</Label>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger aria-label="الملف">
                <SelectValue placeholder="اختر الملف" />
              </SelectTrigger>
              <SelectContent>
                {(cases.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.clients[0]?.fullName ?? "—"} — {c.reference}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="fee-amount">المبلغ المتفق عليه</Label>
              <Input id="fee-amount" dir="ltr" inputMode="decimal" className="text-left font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee-currency">العملة</Label>
              <Input id="fee-currency" dir="ltr" maxLength={3} className="text-left font-mono uppercase" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fee-title">الموضوع (اختياري)</Label>
            <Input id="fee-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="أتعاب التقاضي في الطور التعقيبي" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fee-terms">شروط الدفع (اختياري)</Label>
            <Textarea id="fee-terms" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
