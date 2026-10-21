import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCases, useHearingConflicts } from "@/backend/queries";
import type { HearingConflictsDTO, HearingDTO } from "../../../shared/api";

interface HearingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  /** Fixed case (opened from a case file). */
  caseId?: string;
  /** Reschedule / edit an existing hearing. */
  hearing?: HearingDTO;
  onSaved?: (hearing: HearingDTO) => void;
}

interface Values {
  caseId: string;
  court: string;
  room: string;
  type: string;
  date: string;
  time: string;
  durationMinutes: string;
  reason: string;
}

const EMPTY: Values = { caseId: "", court: "قصر العدالة بتونس", room: "", type: "", date: "", time: "", durationMinutes: "60", reason: "" };

export function HearingDialog({ open, onOpenChange, defaultDate, caseId, hearing, onSaved }: HearingDialogProps) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [ack, setAck] = useState(false);
  const [serverConflicts, setServerConflicts] = useState<HearingConflictsDTO>();
  const cases = useCases({ pageSize: 100, sort: "updatedAt:desc" }, open && !caseId && !hearing);

  useEffect(() => {
    if (!open) return;
    setValues(
      hearing
        ? { caseId: hearing.caseId, court: hearing.court, room: hearing.room ?? "", type: hearing.type, date: hearing.date, time: hearing.time, durationMinutes: String(hearing.durationMinutes), reason: "" }
        : { ...EMPTY, caseId: caseId ?? "", date: defaultDate ?? "" },
    );
    setErrors({});
    setAck(false);
    setServerConflicts(undefined);
  }, [open, defaultDate, caseId, hearing]);

  const duration = Number(values.durationMinutes) || 60;
  const preview = useHearingConflicts({ caseId: values.caseId || undefined, date: values.date || undefined, time: values.time || undefined, durationMinutes: duration, excludeId: hearing?.id });
  const conflicts = serverConflicts ?? preview.data;
  const conflictCount = (conflicts?.hearings.length ?? 0) + (conflicts?.hiddenCount ?? 0);

  const set = (key: keyof Values, value: string) => {
    setServerConflicts(undefined);
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useApiMutation(
    (body: Record<string, unknown>) => (hearing ? api.patch<HearingDTO>(`/hearings/${hearing.id}`, body) : api.post<HearingDTO>("/hearings", body)),
    ["hearings"],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.caseId) next.caseId = "يرجى اختيار القضية";
    if (!values.court.trim()) next.court = "يرجى إدخال المحكمة";
    if (!values.type.trim()) next.type = "يرجى إدخال نوع الجلسة";
    if (!values.date) next.date = "يرجى تحديد التاريخ";
    if (!values.time) next.time = "يرجى تحديد الوقت";
    if (!(duration >= 5 && duration <= 1440)) next.durationMinutes = "مدة غير صالحة";
    setErrors(next);
    if (Object.keys(next).length) return;
    if (conflictCount && !ack) {
      toast.error("يوجد تعارض في التوقيت: أكّد المتابعة أو غيّر الموعد.");
      return;
    }
    const body = {
      ...(hearing ? { version: hearing.version, reason: values.reason.trim() || null } : { caseId: values.caseId }),
      court: values.court.trim(),
      room: values.room.trim() || null,
      type: values.type.trim(),
      date: values.date,
      time: values.time,
      durationMinutes: duration,
      acknowledgeConflicts: ack,
    };
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.success(hearing ? "تم تحديث الجلسة" : "تمت إضافة الجلسة بنجاح");
        onSaved?.(saved);
        onOpenChange(false);
      },
      onError: (err) => {
        if (isApiError(err, "HEARING_CONFLICT")) setServerConflicts(err.data as HearingConflictsDTO);
        toast.error(err.message);
      },
    });
  }

  const err = (k: keyof Values) => errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hearing ? "تعديل موعد الجلسة" : "إضافة جلسة جديدة"}</DialogTitle>
          <DialogDescription>{hearing ? "يُحفظ الموعد السابق في سجل الجلسة." : "أدخل تفاصيل الجلسة الجديدة لإضافتها إلى المفكرة. التوقيت بتوقيت تونس."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!caseId && !hearing && (
            <div className="space-y-1.5">
              <Label>القضية</Label>
              <Select value={values.caseId} onValueChange={(v) => set("caseId", v)}>
                <SelectTrigger aria-label="القضية">
                  <SelectValue placeholder={cases.isPending ? "جارٍ التحميل..." : "اختر القضية"} />
                </SelectTrigger>
                <SelectContent>
                  {(cases.data?.items ?? [])
                    .filter((c) => c.status !== "CLOSED")
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.clients[0]?.fullName ?? "—"} — {c.reference}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {err("caseId")}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="hd-court">المحكمة</Label>
            <Input id="hd-court" value={values.court} onChange={(e) => set("court", e.target.value)} />
            {err("court")}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hd-room">القاعة</Label>
              <Input id="hd-room" placeholder="قاعة 1" value={values.room} onChange={(e) => set("room", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-type">نوع الجلسة</Label>
              <Input id="hd-type" placeholder="جلسة استماع" value={values.type} onChange={(e) => set("type", e.target.value)} />
              {err("type")}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hd-date">التاريخ</Label>
              <Input id="hd-date" type="date" value={values.date} onChange={(e) => set("date", e.target.value)} />
              {err("date")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-time">الوقت</Label>
              <Input id="hd-time" type="time" value={values.time} onChange={(e) => set("time", e.target.value)} />
              {err("time")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-duration">المدة (دقيقة)</Label>
              <Input id="hd-duration" type="number" inputMode="numeric" min={5} max={1440} step={5} value={values.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} />
              {err("durationMinutes")}
            </div>
          </div>
          {hearing && (
            <div className="space-y-1.5">
              <Label htmlFor="hd-reason">سبب التعديل (اختياري)</Label>
              <Input id="hd-reason" value={values.reason} onChange={(e) => set("reason", e.target.value)} />
            </div>
          )}
          {conflictCount > 0 && (
            <div role="alert" className="space-y-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                تعارض مع {conflictCount === 1 ? "جلسة أخرى" : `${conflictCount} جلسات`} للمحامي نفسه
              </p>
              <ul className="list-inside list-disc text-xs">
                {conflicts?.hearings.map((h) => (
                  <li key={h.id}>
                    {h.clientName} (<span dir="ltr">{h.caseReference}</span>) على الساعة {h.time}
                  </li>
                ))}
                {!!conflicts?.hiddenCount && <li>{conflicts.hiddenCount} جلسة في ملفات غير متاحة لك</li>}
              </ul>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-foreground">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                <span className="text-xs">أؤكد البرمجة رغم التعارض</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ الجلسة
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
