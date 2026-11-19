import { useState } from "react";
import { CalendarClock, CheckCircle2, History, Loader2, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HearingDialog } from "@/components/hearings/HearingDialog";
import { api } from "@/backend/http";
import { useApiMutation, useCan, useHearingHistory } from "@/backend/queries";
import { formatArabicDate } from "@/lib/formatters";
import type { HearingDTO, HearingEventDTO } from "../../../shared/api";

type Outcome = "HELD" | "POSTPONED" | "CANCELLED";

/** Compact, always-visible option button. */
const chip = "h-8 gap-1 px-2 text-xs coarse:h-10";

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

  const historyButton = (
    <Button type="button" variant="ghost" size="sm" className={chip} onClick={() => setHistoryOpen(true)}>
      <History className="h-3.5 w-3.5" />
      السجل
    </Button>
  );

  if (!can("hearing:write")) {
    return (
      <>
        {historyButton}
        {historyDialog}
      </>
    );
  }

  function open(o: Outcome) {
    setOutcome(o);
    setReason("");
    setNextDate("");
    setError(undefined);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    if (outcome !== "HELD" && !reason.trim()) return setError("يرجى ذكر السبب");
    change.mutate(
      { status: outcome, reason: reason.trim() || null, version: hearing.version, ...(outcome === "POSTPONED" && nextDate ? { next: { date: nextDate } } : {}) },
      {
        onSuccess: (r) => {
          toast.success(OUTCOME_TITLES[outcome], r.next ? { description: `الجلسة المقبلة: ${formatArabicDate(r.next.date)}` } : undefined);
          setOutcome(null);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  // The options are shown as visible buttons (no hidden "⋮" menu).
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`إجراءات الجلسة: ${hearing.type}`}>
        {scheduled && (
          <>
            <Button type="button" variant="outline" size="sm" className={chip} onClick={() => open("HELD")}>
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              انعقدت
            </Button>
            <Button type="button" variant="outline" size="sm" className={chip} onClick={() => open("POSTPONED")}>
              <PauseCircle className="h-3.5 w-3.5 text-gold-deep" />
              تأجيل
            </Button>
            <Button type="button" variant="outline" size="sm" className={chip} onClick={() => setEditing(true)}>
              <CalendarClock className="h-3.5 w-3.5" />
              تعديل
            </Button>
            {can("hearing:cancel") && (
              <Button type="button" variant="outline" size="sm" className={`${chip} text-alert hover:text-alert`} onClick={() => open("CANCELLED")}>
                <XCircle className="h-3.5 w-3.5" />
                إلغاء
              </Button>
            )}
          </>
        )}
        {historyButton}
      </div>

      <HearingDialog open={editing} onOpenChange={setEditing} hearing={hearing} />

      <Dialog open={!!outcome} onOpenChange={(o) => !o && setOutcome(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{outcome ? OUTCOME_TITLES[outcome] : ""}</DialogTitle>
            <DialogDescription>
              {hearing.type} — {hearing.clientName} ({formatArabicDate(hearing.date)})
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="outcome-reason">{outcome === "HELD" ? "ملاحظة (اختياري)" : "السبب"}</Label>
              <Input id="outcome-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {outcome === "POSTPONED" && (
              <div className="space-y-1.5">
                <Label htmlFor="next-date">تاريخ الجلسة المقبلة (اختياري)</Label>
                <Input id="next-date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
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
