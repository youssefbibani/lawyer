import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/backend/http";
import { useApiMutation, useCases } from "@/backend/queries";
import type { HearingDTO } from "../../../shared/api";

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
  reason: string;
}

const EMPTY: Values = { caseId: "", court: "قصر العدالة بتونس", room: "", type: "", date: "", reason: "" };

/** Room numbers are only used at the Tunis courthouse. */
export const courtHasRooms = (court: string) => /تونس|tunis/i.test(court);

/** Hearings are entered by date only: no time and no duration (the server keeps a default time). */
export function HearingDialog({ open, onOpenChange, defaultDate, caseId, hearing, onSaved }: HearingDialogProps) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const cases = useCases({ pageSize: 100, sort: "updatedAt:desc" }, open && !caseId && !hearing);

  useEffect(() => {
    if (!open) return;
    setValues(
      hearing
        ? { caseId: hearing.caseId, court: hearing.court, room: hearing.room ?? "", type: hearing.type, date: hearing.date, reason: "" }
        : { ...EMPTY, caseId: caseId ?? "", date: defaultDate ?? "" },
    );
    setErrors({});
  }, [open, defaultDate, caseId, hearing]);

  const set = (key: keyof Values, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const hasRooms = courtHasRooms(values.court);

  const save = useApiMutation(
    (body: Record<string, unknown>) => (hearing ? api.patch<HearingDTO>(`/hearings/${hearing.id}`, body) : api.post<HearingDTO>("/hearings", body)),
    ["hearings"],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.caseId) next.caseId = "يرجى اختيار القضية";
    if (!values.court.trim()) next.court = "يرجى إدخال المحكمة";
    if (!values.type.trim()) next.type = "يرجى إدخال موضوع الجلسة";
    if (!values.date) next.date = "يرجى تحديد التاريخ";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      ...(hearing ? { version: hearing.version, reason: values.reason.trim() || null } : { caseId: values.caseId }),
      court: values.court.trim(),
      room: hasRooms ? values.room.trim() || null : null,
      type: values.type.trim(),
      date: values.date,
    };
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.success(hearing ? "تم تحديث الجلسة" : "تمت إضافة الجلسة بنجاح");
        onSaved?.(saved);
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const err = (k: keyof Values) => errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hearing ? "تعديل الجلسة" : "إضافة جلسة جديدة"}</DialogTitle>
          <DialogDescription>{hearing ? "يُحفظ الموعد السابق في سجل الجلسة." : "أدخل تفاصيل الجلسة الجديدة لإضافتها إلى المفكرة."}</DialogDescription>
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
            <Label htmlFor="hd-type">موضوع الجلسة</Label>
            <Input id="hd-type" placeholder="جلسة استماع" value={values.type} onChange={(e) => set("type", e.target.value)} />
            {err("type")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hd-court">المحكمة</Label>
            <Input id="hd-court" value={values.court} onChange={(e) => set("court", e.target.value)} />
            {err("court")}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hd-date">التاريخ</Label>
              <Input id="hd-date" type="date" value={values.date} onChange={(e) => set("date", e.target.value)} />
              {err("date")}
            </div>
            {hasRooms && (
              <div className="space-y-1.5">
                <Label htmlFor="hd-room">القاعة</Label>
                <Input id="hd-room" placeholder="قاعة 1" value={values.room} onChange={(e) => set("room", e.target.value)} />
              </div>
            )}
          </div>
          {hearing && (
            <div className="space-y-1.5">
              <Label htmlFor="hd-reason">سبب التعديل (اختياري)</Label>
              <Input id="hd-reason" value={values.reason} onChange={(e) => set("reason", e.target.value)} />
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
