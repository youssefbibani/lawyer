import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, fieldError, isApiError } from "@/backend/http";
import { useApiMutation, useCan, useClients, useMe, useMembers } from "@/backend/queries";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, CLIENT_TYPE_LABELS } from "@/backend/labels";
import { CASE_STATUSES, CASE_TYPES, CLIENT_TYPES, type CaseDetailDTO, type CaseStatus, type CaseType, type ClientType } from "../../../shared/api";

const NEW_CLIENT = "__new__";

interface Values {
  reference: string;
  type: CaseType | "";
  status: CaseStatus;
  court: string;
  description: string;
  assignedLawyerId: string;
  clientId: string;
  newClientName: string;
  newClientType: ClientType;
  newClientPhone: string;
  hearingDate: string;
  hearingTime: string;
}

export function NewCaseDialog({ open, onOpenChange, defaultClientId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultClientId?: string }) {
  const navigate = useNavigate();
  const can = useCan();
  const { data: me } = useMe();
  const members = useMembers();
  const clients = useClients({ pageSize: 100, sort: "fullName:asc" }, open);
  const lawyers = (members.data ?? []).filter((m) => m.role === "lawyer" || m.role === "admin");
  const blank = (): Values => ({
    reference: "",
    type: "",
    status: "ACTIVE",
    court: "",
    description: "",
    assignedLawyerId: me && me.role !== "clerk" ? me.user.id : "",
    clientId: defaultClientId ?? NEW_CLIENT,
    newClientName: "",
    newClientType: "INDIVIDUAL",
    newClientPhone: "",
    hearingDate: "",
    hearingTime: "",
  });
  const [values, setValues] = useState<Values>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    if (open) {
      setValues(blank());
      setErrors({});
      setServerError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((s) => ({ ...s, [k]: v }));

  const create = useApiMutation(async (v: Values) => {
    const created = await api.post<CaseDetailDTO>("/cases", {
      reference: v.reference.trim(),
      type: v.type,
      status: v.status,
      court: v.court.trim(),
      description: v.description.trim() || null,
      assignedLawyerId: v.assignedLawyerId,
      ...(v.clientId === NEW_CLIENT ? { newClient: { type: v.newClientType, fullName: v.newClientName.trim(), phone: v.newClientPhone.trim() || null } } : { clientIds: [v.clientId] }),
    });
    let hearingError: string | undefined;
    if (v.hearingDate && v.hearingTime) {
      try {
        await api.post("/hearings", { caseId: created.id, date: v.hearingDate, time: v.hearingTime, court: v.court.trim(), type: "جلسة", acknowledgeConflicts: true });
      } catch (err) {
        hearingError = (err as Error).message;
      }
    }
    return { created, hearingError };
  }, ["cases", "hearings"]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!values.reference.trim()) next.reference = "يرجى إدخال مرجع القضية";
    if (!values.type) next.type = "يرجى اختيار نوع القضية";
    if (!values.court.trim()) next.court = "يرجى إدخال اسم المحكمة";
    if (!values.assignedLawyerId) next.assignedLawyerId = "يرجى اختيار المحامي المكلّف";
    if (values.clientId === NEW_CLIENT && !values.newClientName.trim()) next.newClientName = "يرجى إدخال اسم الحريف";
    if (!!values.hearingDate !== !!values.hearingTime) next.hearingTime = "حدّد تاريخ وساعة الجلسة معاً (أو اتركهما فارغين)";
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>قضية جديدة</DialogTitle>
          <DialogDescription>أدخل بيانات القضية الجديدة لإضافتها إلى قائمة الملفات.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label>الحريف</Label>
            <Select value={values.clientId} onValueChange={(v) => set("clientId", v)}>
              <SelectTrigger aria-label="الحريف">
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
                <Label htmlFor="nc-client">اسم الحريف</Label>
                <Input id="nc-client" placeholder="مثال: عائلة بن صالح" value={values.newClientName} onChange={(e) => set("newClientName", e.target.value)} />
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
              <Label htmlFor="nc-ref">مرجع القضية</Label>
              <Input id="nc-ref" placeholder="CC/2026/0001" dir="ltr" className="text-left" value={values.reference} onChange={(e) => set("reference", e.target.value)} />
              {err("reference")}
            </div>
            <div className="space-y-1.5">
              <Label>نوع القضية</Label>
              <Select value={values.type} onValueChange={(v) => set("type", v as CaseType)}>
                <SelectTrigger aria-label="نوع القضية">
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
          <div className="space-y-1.5">
            <Label htmlFor="nc-court">المحكمة</Label>
            <Input id="nc-court" placeholder="محكمة التعقيب — الدائرة المدنية" value={values.court} onChange={(e) => set("court", e.target.value)} />
            {err("court")}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="space-y-1.5">
              <Label>الحالة</Label>
              <Select value={values.status} onValueChange={(v) => set("status", v as CaseStatus)} disabled={!can("case:status")}>
                <SelectTrigger aria-label="الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CASE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="nc-hdate">الجلسة الأولى (اختياري)</Label>
              <Input id="nc-hdate" type="date" value={values.hearingDate} onChange={(e) => set("hearingDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-htime">ساعة الجلسة</Label>
              <Input id="nc-htime" type="time" value={values.hearingTime} onChange={(e) => set("hearingTime", e.target.value)} />
            </div>
            <div className="col-span-2">{err("hearingTime")}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-desc">وصف مختصر</Label>
            <Textarea id="nc-desc" rows={3} placeholder="وصف موجز لموضوع القضية" value={values.description} onChange={(e) => set("description", e.target.value)} />
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
