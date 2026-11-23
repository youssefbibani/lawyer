import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CaseScan } from "@/components/cases/CaseScan";
import { DateField } from "@/components/shared/DateField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, fieldError, isApiError } from "@/backend/http";
import { useApiMutation, useClients, useMe, useMembers } from "@/backend/queries";
import { CASE_TYPE_LABELS, CLIENT_TYPE_LABELS } from "@/backend/labels";
import { normalizeText } from "@/lib/arabic";
import { cn } from "@/lib/utils";
import type { ScanKey } from "@/services/cases/scan";
import { CASE_TYPES, CLIENT_TYPES, type CaseDetailDTO, type CaseType, type ClientType } from "../../../shared/api";

const NEW_CLIENT = "__new__";

/** Form fields a scanned document can fill (and that are outlined until the lawyer edits them). */
type AutoField = "reference" | "type" | "court" | "newClientName" | "clientId" | "hearingDate" | "description";

/** Small tag shown next to a field while it still holds a value read from the document. */
function FromDoc({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="mr-1 inline-flex shrink-0 items-center gap-1 rounded-sm bg-gold/15 px-1.5 text-[10px] font-medium text-gold-deep">
      <ScanText className="h-3 w-3" aria-hidden="true" />
      من الوثيقة
    </span>
  );
}

// Fields written "on the dotted line", like the paper case cover («القشرة»).
const line =
  "h-9 rounded-none border-0 border-b border-dashed border-sky-900/30 bg-transparent px-1 shadow-none focus-visible:border-solid focus-visible:border-gold focus-visible:ring-0 dark:border-sky-100/25 coarse:h-10";
const lineSelect =
  "h-9 rounded-none border-0 border-b border-dashed border-sky-900/30 bg-transparent px-1 shadow-none focus:border-solid focus:border-gold focus:ring-0 dark:border-sky-100/25 coarse:h-10";
const cell = "h-9 rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:bg-white/70 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gold dark:focus-visible:bg-white/5";

/** One labelled line of the cover: «الاسم واللقب : ............». */
function Line({ label, htmlFor, required, fromDoc, error, children }: { label: string; htmlFor: string; required?: boolean; fromDoc?: boolean; error?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-end gap-2">
        <Label htmlFor={htmlFor} className="shrink-0 whitespace-nowrap pb-2 text-[13px] font-semibold opacity-80 after:content-[':']">
          {label}
        </Label>
        {required && (
          <span className="-mr-1.5 pb-2 text-xs text-alert" aria-hidden="true">
            *
          </span>
        )}
        <div className="min-w-0 flex-1">{children}</div>
        {fromDoc && (
          <span className="pb-2">
            <FromDoc show />
          </span>
        )}
      </div>
      {error}
    </div>
  );
}

interface Values {
  reference: string;
  type: CaseType | "";
  court: string;
  chamber: string;
  description: string;
  assignedLawyerId: string;
  clientId: string;
  newClientName: string;
  newClientType: ClientType;
  newClientPhone: string;
  newClientAddress: string;
  opponentName: string;
  opponentLawyer: string;
  hearingDate: string;
  hearingNotes: string;
  /** The lawyer's own case type when «نوع آخر» is chosen. */
  otherType: string;
}

/** A typed case type and the opposing party are kept in the case summary (no dedicated fields on the server). */
function summaryWithOpponent(v: Values): string | null {
  const kind = v.type === "OTHER" && v.otherType.trim() ? `النوع: ${v.otherType.trim()}` : "";
  const opponent = v.opponentName.trim() ? `الضد: ${v.opponentName.trim()}${v.opponentLawyer.trim() ? ` — نائبه الأستاذ ${v.opponentLawyer.trim()}` : ""}` : "";
  return [kind, v.description.trim(), opponent].filter(Boolean).join("\n") || null;
}

export function NewCaseDialog({ open, onOpenChange, defaultClientId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultClientId?: string }) {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const members = useMembers();
  const clients = useClients({ pageSize: 100, sort: "fullName:asc" }, open);
  const lawyers = (members.data ?? []).filter((m) => m.role === "lawyer" || m.role === "admin");
  const blank = (): Values => ({
    reference: "",
    type: "",
    court: "",
    chamber: "",
    description: "",
    assignedLawyerId: me && me.role !== "clerk" ? me.user.id : "",
    clientId: defaultClientId ?? NEW_CLIENT,
    newClientName: "",
    newClientType: "INDIVIDUAL",
    newClientPhone: "",
    newClientAddress: "",
    opponentName: "",
    opponentLawyer: "",
    hearingDate: "",
    hearingNotes: "",
    otherType: "",
  });
  const [values, setValues] = useState<Values>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string>();
  const [autoFilled, setAutoFilled] = useState<ReadonlySet<AutoField>>(new Set());
  const beforeScan = useRef<Values | null>(null);

  useEffect(() => {
    if (open) {
      setValues(blank());
      setErrors({});
      setServerError(undefined);
      setAutoFilled(new Set());
      beforeScan.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    // Edited by the lawyer: no longer "from the document".
    setAutoFilled((a) => {
      if (!a.has(k as AutoField)) return a;
      const next = new Set(a);
      next.delete(k as AutoField);
      return next;
    });
  };
  const auto = (k: AutoField) => autoFilled.has(k);
  const autoClass = (k: AutoField) => (auto(k) ? "border-gold bg-gold/5 ring-1 ring-gold/40" : undefined);

  /** Fills the fields the lawyer kept in the scan review. */
  function applyScan(scan: Partial<Record<ScanKey, string>>) {
    beforeScan.current = values;
    const next: Values = { ...values };
    const filled = new Set<AutoField>();
    const fill = <K extends AutoField>(key: K, value: Values[K]) => {
      next[key] = value;
      filled.add(key);
    };
    if (scan.reference) fill("reference", scan.reference);
    if (scan.type && (CASE_TYPES as readonly string[]).includes(scan.type)) fill("type", scan.type as CaseType);
    if (scan.court) fill("court", scan.court);
    if (scan.hearingDate) fill("hearingDate", scan.hearingDate);
    if (scan.description) fill("description", scan.description);
    if (scan.clientName) {
      // An existing client with the same name is selected rather than created twice.
      const existing = (clients.data?.items ?? []).find((c) => normalizeText(c.fullName) === normalizeText(scan.clientName!));
      if (existing) fill("clientId", existing.id);
      else {
        next.clientId = NEW_CLIENT;
        fill("newClientName", scan.clientName);
      }
    }
    setValues(next);
    setAutoFilled(filled);
    setErrors({});
  }

  function undoScan() {
    if (beforeScan.current) setValues(beforeScan.current);
    beforeScan.current = null;
    setAutoFilled(new Set());
  }

  /** No lawyer field on the cover: the lawyer opening the case keeps it; a secretary's goes to the first lawyer. */
  const lawyerFor = (v: Values) => v.assignedLawyerId || (me && me.role !== "clerk" ? me.user.id : lawyers[0]?.userId) || "";

  const create = useApiMutation(async (v: Values) => {
    const created = await api.post<CaseDetailDTO>("/cases", {
      reference: v.reference.trim(),
      type: v.type,
      // A new case is always active («قضية جديدة = قضية منشورة»).
      status: "ACTIVE",
      court: v.court.trim(),
      chamber: v.chamber.trim() || null,
      description: summaryWithOpponent(v),
      assignedLawyerId: lawyerFor(v),
      ...(v.clientId === NEW_CLIENT ? { newClient: { type: v.newClientType, fullName: v.newClientName.trim(), phone: v.newClientPhone.trim() || null, address: v.newClientAddress.trim() || null } } : { clientIds: [v.clientId] }),
    });
    let hearingError: string | undefined;
    if (v.hearingDate) {
      try {
        await api.post("/hearings", { caseId: created.id, date: v.hearingDate, court: v.court.trim(), chamber: v.chamber.trim() || null, type: "جلسة", notes: v.hearingNotes.trim() || null });
      } catch (err) {
        hearingError = (err as Error).message;
      }
    }
    return { created, hearingError };
  }, ["cases", "hearings"]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!values.reference.trim()) next.reference = "يرجى إدخال عدد القضية";
    if (!values.type) next.type = "يرجى اختيار نوع القضية";
    else if (values.type === "OTHER" && !values.otherType.trim()) next.type = "اكتب نوع القضية";
    if (!values.court.trim()) next.court = "يرجى إدخال اسم المحكمة";
    if (values.clientId === NEW_CLIENT && !values.newClientName.trim()) next.newClientName = "يرجى إدخال اسم الحريف";
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!lawyerFor(values)) return setServerError("لا يوجد محامٍ في المكتب لتُسند إليه القضية.");
    setServerError(undefined);
    create.mutate(values, {
      onSuccess: ({ created, hearingError }) => {
        onOpenChange(false);
        if (hearingError) toast.warning("تم إنشاء القضية، لكن لم تُبرمج الجلسة", { description: hearingError });
        else toast.success("تم إنشاء القضية وحفظها");
        navigate(`/app/cases/${created.id}`);
      },
      onError: (err) => {
        setServerError(err.message);
        if (isApiError(err)) setErrors((e) => ({ ...e, reference: fieldError(err, "reference") ?? (err.code === "CONFLICT" ? err.message : e.reference ?? "") }));
      },
    });
  }

  const err = (k: string) => errors[k] && <p className="mt-0.5 text-xs text-destructive">{errors[k]}</p>;
  const isNew = values.clientId === NEW_CLIENT;
  const chosenClient = isNew ? undefined : (clients.data?.items ?? []).find((c) => c.id === values.clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>قضية جديدة</DialogTitle>
          <DialogDescription>املأ القشرة كما تملؤها على الورق. الخانات المعلّمة بـ * إلزامية.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <CaseScan onApply={applyScan} onUndo={undoScan} />

          {/* The case cover («القشرة»): same blocks, same order as the paper folder the office already uses. */}
          <div className="rounded-[var(--radius)] border border-sky-900/20 bg-sky-50/70 text-sky-950 shadow-sm dark:border-sky-200/15 dark:bg-sky-950/25 dark:text-sky-50">
            {/* Head of the cover: court and chamber on the right, case number and type on the left. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 px-4 pb-3 pt-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Line label="المحكمة" htmlFor="nc-court" required fromDoc={auto("court")} error={err("court")}>
                  <Input id="nc-court" placeholder="المحكمة الابتدائية بنابل" className={cn(line, autoClass("court"))} value={values.court} onChange={(e) => set("court", e.target.value)} />
                </Line>
                <Line label="الدائرة" htmlFor="nc-chamber">
                  <Input id="nc-chamber" placeholder="المدنية" className={line} value={values.chamber} onChange={(e) => set("chamber", e.target.value)} />
                </Line>
              </div>
              <div className="space-y-1">
                <Line label="عدد القضية" htmlFor="nc-ref" required fromDoc={auto("reference")} error={err("reference")}>
                  <Input id="nc-ref" placeholder="45821/2026" dir="ltr" className={cn(line, "text-left font-mono", autoClass("reference"))} value={values.reference} onChange={(e) => set("reference", e.target.value)} />
                </Line>
                <Line label="نوع القضية" htmlFor="nc-type" required fromDoc={auto("type")} error={err("type")}>
                  <div className="flex items-end gap-2">
                    <Select
                      value={values.type}
                      onValueChange={(v) => {
                        set("type", v as CaseType);
                        // «نوع آخر»: the lawyer writes the type right away.
                        if (v === "OTHER") setTimeout(() => document.getElementById("nc-type-other")?.focus(), 50);
                      }}
                    >
                      <SelectTrigger id="nc-type" aria-label="نوع القضية" className={cn(lineSelect, values.type === "OTHER" && "w-28 shrink-0", autoClass("type"))}>
                        <SelectValue placeholder="اختر" />
                      </SelectTrigger>
                      <SelectContent>
                        {CASE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t === "OTHER" ? "نوع آخر…" : CASE_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {values.type === "OTHER" && (
                      <Input id="nc-type-other" aria-label="اكتب نوع القضية" placeholder="اكتب النوع…" className={cn(line, "min-w-0 flex-1")} value={values.otherType} onChange={(e) => set("otherType", e.target.value)} />
                    )}
                  </div>
                </Line>
              </div>
            </div>

            {/* The two parties, side by side like the boxed table on the cover. */}
            <div className="grid grid-cols-1 border-y border-sky-900/20 sm:grid-cols-2 dark:border-sky-200/15">
              <fieldset aria-labelledby="nc-side-client" className="min-w-0 space-y-1 px-4 pb-3 pt-2 sm:border-l sm:border-sky-900/20 dark:sm:border-sky-200/15">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="nc-side-client" className="flex items-center text-sm font-bold">
                    النيابة عن
                    <FromDoc show={auto("clientId")} />
                  </h3>
                  <Select value={values.clientId} onValueChange={(v) => set("clientId", v)}>
                    <SelectTrigger aria-label="الحريف" className="h-7 w-auto max-w-[60%] gap-1 border-sky-900/20 bg-white/60 px-2 text-xs coarse:h-9 dark:border-sky-200/20 dark:bg-transparent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_CLIENT}>حريف جديد</SelectItem>
                      {(clients.data?.items ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isNew ? (
                  <>
                    <Line label="الاسم واللقب" htmlFor="nc-client" required fromDoc={auto("newClientName")} error={err("newClientName")}>
                      <Input id="nc-client" aria-label="اسم الحريف" placeholder="عائلة بن صالح" className={cn(line, autoClass("newClientName"))} value={values.newClientName} onChange={(e) => set("newClientName", e.target.value)} />
                    </Line>
                    <Line label="العنوان" htmlFor="nc-address">
                      <Input id="nc-address" className={line} value={values.newClientAddress} onChange={(e) => set("newClientAddress", e.target.value)} />
                    </Line>
                    <div className="grid grid-cols-[2fr_3fr] gap-x-3">
                      <Line label="الهاتف" htmlFor="nc-phone">
                        <Input id="nc-phone" dir="ltr" inputMode="tel" className={cn(line, "text-left font-mono")} value={values.newClientPhone} onChange={(e) => set("newClientPhone", e.target.value)} />
                      </Line>
                      <Line label="الصفة" htmlFor="nc-ctype">
                        <Select value={values.newClientType} onValueChange={(v) => set("newClientType", v as ClientType)}>
                          <SelectTrigger id="nc-ctype" aria-label="صفة الحريف" className={lineSelect}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CLIENT_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {CLIENT_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Line>
                    </div>
                  </>
                ) : (
                  <div className="py-2">
                    <p className="text-base font-semibold">{chosenClient?.fullName}</p>
                    <p className="text-xs opacity-70">
                      حريف مسجّل{chosenClient?.phone ? " · " : ""}
                      {chosenClient?.phone && <span dir="ltr" className="font-mono">{chosenClient.phone}</span>}
                    </p>
                  </div>
                )}
              </fieldset>
              <fieldset aria-labelledby="nc-side-opp" className="min-w-0 space-y-1 border-t border-sky-900/20 px-4 pb-3 pt-2 sm:border-t-0 dark:border-sky-200/15">
                <h3 id="nc-side-opp" className="flex h-7 items-center text-sm font-bold">
                  الضد
                </h3>
                <Line label="الاسم واللقب" htmlFor="nc-opp">
                  <Input id="nc-opp" aria-label="اسم الضد" placeholder="اختياري" className={line} value={values.opponentName} onChange={(e) => set("opponentName", e.target.value)} />
                </Line>
                <Line label="نائبه الأستاذ" htmlFor="nc-opp-lawyer">
                  <Input id="nc-opp-lawyer" placeholder="اختياري" className={line} value={values.opponentLawyer} onChange={(e) => set("opponentLawyer", e.target.value)} />
                </Line>
              </fieldset>
            </div>

            <div className="px-4 pb-1 pt-2">
              <Line label="موضوع الدعوى" htmlFor="nc-desc" fromDoc={auto("description")}>
                <Input id="nc-desc" placeholder="كفّ شغب، استحقاق، طلاق…" className={cn(line, autoClass("description"))} value={values.description} onChange={(e) => set("description", e.target.value)} />
              </Line>
            </div>

            {/* The hearings table of the cover: only the first line is filled here; the case file keeps the rest. */}
            <div className="px-4 pb-3 pt-1">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead>
                  <tr className="text-xs font-bold">
                    <th scope="col" className="w-40 border border-sky-900/25 px-2 py-1 text-right dark:border-sky-200/20">
                      تاريخ الجلسات
                      <FromDoc show={auto("hearingDate")} />
                    </th>
                    <th scope="col" className="w-28 border border-sky-900/25 px-2 py-1 text-right dark:border-sky-200/20">
                      سبب التأجيل
                    </th>
                    <th scope="col" className="border border-sky-900/25 px-2 py-1 text-right dark:border-sky-200/20">
                      الملاحظات
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-sky-900/25 p-0 dark:border-sky-200/20">
                      <DateField id="nc-hdate" side="up" aria-label="الجلسة الأولى" className={cn(cell, autoClass("hearingDate"))} value={values.hearingDate} onChange={(v) => set("hearingDate", v)} />
                    </td>
                    <td className="border border-sky-900/25 px-2 text-xs opacity-60 dark:border-sky-200/20">الجلسة الأولى</td>
                    <td className="border border-sky-900/25 p-0 dark:border-sky-200/20">
                      <Input aria-label="ملاحظات الجلسة الأولى" placeholder={values.hearingDate ? "اختياري" : "حدّد تاريخ الجلسة أولاً"} disabled={!values.hearingDate} className={cell} value={values.hearingNotes} onChange={(e) => set("hearingNotes", e.target.value)} />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-[11px] opacity-60">الجلسات التالية تُضاف من ملف القضية، ويُسجَّل سبب التأجيل عند تأجيل الجلسة.</p>
            </div>
          </div>

          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ القضية
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
