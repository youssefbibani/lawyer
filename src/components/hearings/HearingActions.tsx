import { useState } from "react";
import { CalendarClock, CheckCircle2, History, Loader2, MoreVertical, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HearingDialog } from "@/components/hearings/HearingDialog";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCan, useHearingHistory } from "@/backend/queries";
import { formatArabicDate } from "@/lib/formatters";
import type { HearingDTO, HearingEventDTO } from "../../../shared/api";

type Outcome = "HELD" | "POSTPONED" | "CANCELLED";

const OUTCOME_TITLES: Record<Outcome, string> = { HELD: "تسجيل انعقاد الجلسة", POSTPONED: "تأجيل الجلسة", CANCELLED: "إلغاء الجلسة" };

const EVENT_LABELS: Record<HearingEventDTO["kind"], string> = {
  CREATED: "برمجة الجلسة",
  UPDATED: "تعديل البيانات",
  RESCHEDULED: "تغيير الموعد",
  STATUS_CHANGED: "تغيير الحالة",
  CANCELLED: "إلغاء",
};

/** Per-hearing actions: reschedule, record the outcome (held / postponed / cancelled) and view history. */
export function HearingActions({ hearing }: { hearing: HearingDTO }) {
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string>();
  const history = useHearingHistory(historyOpen ? hearing.id : undefined);

  const change = useApiMutation((body: Record<string, unknown>) => api.post<{ hearing: HearingDTO; next: HearingDTO | null }>(`/hearings/${hearing.id}/status`, body), ["hearings"]);

  const scheduled = hearing.status === "SCHEDULED";
  const historyDialog = (
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>سجل الجلسة</DialogTitle>
              <DialogDescription>كل تغيير على الجلسة محفوظ ولا يُحذف.</DialogDescription>
            </DialogHeader>
            {history.isPending ? (
              <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
            ) : history.error ? (
              <p className="text-sm text-alert">{history.error.message}</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {history.data?.map((e) => (
                  <li key={e.id} className="border-r-2 border-gold/40 pr-3">
                    <p className="font-medium">{EVENT_LABELS[e.kind]}</p>
                    {e.before && e.after && "date" in e.before && (
                      <p className="text-xs text-muted-foreground">
                        من {String(e.before.date)} {String(e.before.time)} إلى {String(e.after.date)} {String(e.after.time)}
                      </p>
                    )}
                    {e.reason && <p className="text-xs text-muted-foreground">السبب: {e.reason}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      {e.actor.name} • <span className="font-mono">{new Date(e.createdAt).toLocaleString("en-GB")}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </DialogContent>
        </Dialog>
  );

  if (!can("hearing:write")) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} aria-label={`سجل الجلسة ${hearing.type}`}>
          <History className="h-4 w-4" />
        </Button>
        {historyDialog}
      </>
    );
  }

  function open(o: Outcome) {
    setOutcome(o);
    setReason("");
    setNextDate("");
    setNextTime("");
    setAck(false);
    setError(undefined);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    if (outcome !== "HELD" && !reason.trim()) return setError("يرجى ذكر السبب");
    if ((nextDate && !nextTime) || (!nextDate && nextTime)) return setError("حدّد تاريخ وساعة الجلسة المقبلة معاً");
    change.mutate(
      { status: outcome, reason: reason.trim() || null, version: hearing.version, acknowledgeConflicts: ack, ...(outcome === "POSTPONED" && nextDate ? { next: { date: nextDate, time: nextTime } } : {}) },
      {
        onSuccess: (r) => {
          toast.success(OUTCOME_TITLES[outcome], r.next ? { description: `الجلسة المقبلة: ${formatArabicDate(r.next.date)} على الساعة ${r.next.time}` } : undefined);
          setOutcome(null);
        },
        onError: (err) => setError(isApiError(err, "HEARING_CONFLICT") ? `${err.message} (فعّل خيار التأكيد للمتابعة)` : err.message),
      },
    );
  }

  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`إجراءات الجلسة: ${hearing.type}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {scheduled && (
            <>
              <DropdownMenuItem className="min-h-11" onSelect={() => setEditing(true)}>
                <CalendarClock className="h-4 w-4" />
                تعديل الموعد
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => open("HELD")}>
                <CheckCircle2 className="h-4 w-4" />
                انعقدت الجلسة
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => open("POSTPONED")}>
                <PauseCircle className="h-4 w-4" />
                تأجيل
              </DropdownMenuItem>
              {can("hearing:cancel") && (
                <DropdownMenuItem className="min-h-11 text-alert focus:text-alert" onSelect={() => open("CANCELLED")}>
                  <XCircle className="h-4 w-4" />
                  إلغاء الجلسة
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuItem className="min-h-11" onSelect={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
            سجل الجلسة
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <HearingDialog open={editing} onOpenChange={setEditing} hearing={hearing} />

      <Dialog open={!!outcome} onOpenChange={(o) => !o && setOutcome(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{outcome ? OUTCOME_TITLES[outcome] : ""}</DialogTitle>
            <DialogDescription>
              {hearing.type} — {hearing.clientName} ({formatArabicDate(hearing.date)} {hearing.time})
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="outcome-reason">{outcome === "HELD" ? "ملاحظة (اختياري)" : "السبب"}</Label>
              <Input id="outcome-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {outcome === "POSTPONED" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="next-date">تاريخ الجلسة المقبلة</Label>
                  <Input id="next-date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="next-time">الساعة</Label>
                  <Input id="next-time" type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
                </div>
                <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                  أؤكد البرمجة حتى عند وجود تعارض
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" variant={outcome === "CANCELLED" ? "destructive" : "default"} disabled={change.isPending}>
                {change.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                تأكيد
              </Button>
              <Button type="button" variant="outline" onClick={() => setOutcome(null)}>
                رجوع
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {historyDialog}
    </>
  );
}
