import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CaseScan } from "@/components/cases/CaseScan";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/** Small tag shown on a label while its field still holds a value read from the document. */
function FromDoc({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="mr-2 inline-flex items-center gap-1 rounded-sm bg-gold/15 px-1.5 text-[10px] font-medium text-gold-deep">
      <ScanText className="h-3 w-3" aria-hidden="true" />
      من الوثيقة
    </span>
  );
}

interface Values {
  reference: string;
  type: CaseType | "";
  court: string;
  description: string;
  assignedLawyerId: string;
  clientId: string;
  newClientName: string;
  newClientType: ClientType;
  newClientPhone: string;
  hearingDate: string;
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
    description: "",
    assignedLawyerId: me && me.role !== "clerk" ? me.user.id : "",
    clientId: defaultClientId ?? NEW_CLIENT,
    newClientName: "",
    newClientType: "INDIVIDUAL",
    newClientPhone: "",
    hearingDate: "",
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

  const create = useApiMutation(async (v: Values) => {
    const created = await api.post<CaseDetailDTO>("/cases", {
      reference: v.reference.trim(),
      type: v.type,
      // A new case is always active («قضية جديدة = قضية منشورة»).
      status: "ACTIVE",
      court: v.court.trim(),
      description: v.description.trim() || null,
      assignedLawyerId: v.assignedLawyerId,
      ...(v.clientId === NEW_CLIENT ? { newClient: { type: v.newClientType, fullName: v.newClientName.trim(), phone: v.newClientPhone.trim() || null } } : { clientIds: [v.clientId] }),
    });
    let hearingError: string | undefined;
    if (v.hearingDate) {
      try {
        await api.post("/hearings", { caseId: created.id, date: v.hearingDate, court: v.court.trim(), type: "جلسة" });
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
    if (!values.court.trim()) next.court = "يرجى إدخال اسم المحكمة";
    if (!values.assignedLawyerId) next.assignedLawyerId = "يرجى اختيار المحامي المكلّف";
    if (values.clientId === NEW_CLIENT && !values.newClientName.trim()) next.newClientName = "يرجى إدخال اسم الحريف";
    setErrors(next);
    if (Object.keys(next).length) return;
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

  const err = (k: string) => errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>قضية جديدة</DialogTitle>
          <DialogDescription>أدخل بيانات القضية الجديدة لإضافتها إلى قائمة الملفات.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <CaseScan onApply={applyScan} onUndo={undoScan} />
          <div className="space-y-1.5">
            <Label>
              الحريف
              <FromDoc show={auto("clientId")} />
            </Label>
            <Select value={values.clientId} onValueChange={(v) => set("clientId", v)}>
              <SelectTrigger aria-label="الحريف" className={autoClass("clientId")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_CLIENT}>+ حريف جديد</SelectItem>
                {(clients.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {values.clientId === NEW_CLIENT && (
            <div className="grid grid-cols-1 gap-4 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="nc-client">
                  اسم الحريف
                  <FromDoc show={auto("newClientName")} />
                </Label>
                <Input id="nc-client" placeholder="مثال: عائلة بن صالح" className={autoClass("newClientName")} value={values.newClientName} onChange={(e) => set("newClientName", e.target.value)} />
                {err("newClientName")}
              </div>
              <div className="space-y-1.5 sm:col-span-1">
                <Label>الصفة</Label>
                <Select value={values.newClientType} onValueChange={(v) => set("newClientType", v as ClientType)}>
                  <SelectTrigger aria-label="صفة الحريف">
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
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nc-phone">الهاتف (اختياري)</Label>
                <Input id="nc-phone" dir="ltr" className="text-left" value={values.newClientPhone} onChange={(e) => set("newClientPhone", e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-ref">
                عدد القضية
                <FromDoc show={auto("reference")} />
              </Label>
              <Input id="nc-ref" placeholder="CC/2026/0001" dir="ltr" className={cn("text-left", autoClass("reference"))} value={values.reference} onChange={(e) => set("reference", e.target.value)} />
              {err("reference")}
            </div>
            <div className="space-y-1.5">
              <Label>
                نوع القضية
                <FromDoc show={auto("type")} />
              </Label>
              <Select value={values.type} onValueChange={(v) => set("type", v as CaseType)}>
                <SelectTrigger aria-label="نوع القضية" className={autoClass("type")}>
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CASE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("type")}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-court">
                المحكمة
                <FromDoc show={auto("court")} />
              </Label>
              <Input id="nc-court" placeholder="محكمة التعقيب — الدائرة المدنية" className={autoClass("court")} value={values.court} onChange={(e) => set("court", e.target.value)} />
              {err("court")}
            </div>
            <div className="space-y-1.5">
              <Label>المحامي المكلّف</Label>
              <Select value={values.assignedLawyerId} onValueChange={(v) => set("assignedLawyerId", v)}>
                <SelectTrigger aria-label="المحامي المكلّف">
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {lawyers.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("assignedLawyerId")}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-hdate">
                الجلسة الأولى (اختياري)
                <FromDoc show={auto("hearingDate")} />
              </Label>
              <Input id="nc-hdate" type="date" className={autoClass("hearingDate")} value={values.hearingDate} onChange={(e) => set("hearingDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-desc">
                وصف مختصر
                <FromDoc show={auto("description")} />
              </Label>
              <Textarea id="nc-desc" rows={1} className={cn("min-h-10", autoClass("description"))} placeholder="وصف موجز لموضوع القضية" value={values.description} onChange={(e) => set("description", e.target.value)} />
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
