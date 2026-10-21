import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isSameDay } from "date-fns";
import { AlertTriangle, BellPlus, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { HearingDialog } from "@/components/hearings/HearingDialog";
import { MonthCalendar } from "@/components/hearings/MonthCalendar";
import { HearingActions } from "@/components/hearings/HearingActions";
import { TaskDialog, type TaskDefaults } from "@/components/tasks/TaskDialog";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useIsCompact } from "@/hooks/use-media-query";
import { urgencyLabelOf, urgencyToneOf } from "@/lib/status";
import { formatArabicDate } from "@/lib/formatters";
import { ARABIC_WEEKDAYS, ARABIC_WEEKDAYS_SHORT, addDays, parseISODate, startOfDay, toISODate, urgencyOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCan, useConflictGroups, useHearings, useMe } from "@/backend/queries";
import { HEARING_STATUS_LABELS } from "@/backend/labels";
import type { HearingDTO } from "../../shared/api";

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  return addDays(d, -d.getDay()); // Sunday-first, like the month calendar
}

interface ReminderChannels {
  inApp: boolean;
  email: boolean;
}

export default function Agenda() {
  const can = useCan();
  const { data: me } = useMe();
  const compact = useIsCompact();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const listRef = useRef<HTMLDivElement>(null);
  const [reminderDefaults, setReminderDefaults] = useState<TaskDefaults | undefined>();
  const [reminderChannels, setReminderChannels] = useLocalStorage<ReminderChannels>("qasr-al-adala:hearing-reminder-channels", { inApp: true, email: false });
  const mailConfigured = !!me?.mail.configured;

  const today = toISODate(new Date());
  // Default window (-90d…+1y), widened to whatever month the calendar is showing.
  const range = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const from = new Date(Math.min(addDays(now, -90).getTime(), monthStart.getTime()));
    const to = new Date(Math.max(addDays(now, 365).getTime(), monthEnd.getTime()));
    return { from: toISODate(from), to: toISODate(to) };
  }, [month]);
  const hearingsQuery = useHearings(range);
  const conflictsQuery = useConflictGroups();
  const hearings = useMemo(() => hearingsQuery.data?.items ?? [], [hearingsQuery.data]);
  const conflicts = conflictsQuery.data ?? [];
  const scheduled = useMemo(() => hearings.filter((h) => h.status === "SCHEDULED"), [hearings]);

  const visible = useMemo(() => {
    return selectedDate ? hearings.filter((h) => isSameDay(parseISODate(h.date), selectedDate)) : scheduled.filter((h) => h.date >= today);
  }, [hearings, scheduled, selectedDate, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, HearingDTO[]>();
    for (const h of visible) map.set(h.date, [...(map.get(h.date) ?? []), h]);
    return [...map.entries()];
  }, [visible]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function remindFor(h: HearingDTO) {
    setReminderDefaults({
      kind: "REMINDER",
      caseId: h.caseId,
      hearingId: h.id,
      title: `التذكير بـ${h.type} — ${h.clientName}`,
      dueDate: toISODate(addDays(parseISODate(h.date), -1)),
      dueTime: "09:00",
      notifyInApp: reminderChannels.inApp,
      notifyEmail: reminderChannels.email && mailConfigured,
    });
  }

  function selectDate(date: Date | undefined) {
    setSelectedDate(date);
    if (!date || compact) return;
    // The day's hearings are listed below the (tall) calendar: bring them into view.
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" }));
  }

  const monthCalendar = (
    <MonthCalendar
      month={month}
      onMonthChange={setMonth}
      hearings={scheduled}
      selectedDate={selectedDate}
      onSelectDate={selectDate}
      loadFailed={!!hearingsQuery.error}
    />
  );

  return (
    <AppShell title="المفكرة الذكية" subtitle="جلسات المحاكم وتذكيرات المواعيد (بتوقيت تونس)">
      <div className="space-y-5 sm:space-y-6">
        {conflicts.map((group) => (
          <div key={group[0].id} role="alert" className="flex items-start gap-3 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-alert" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-alert">تنبيه: يوجد تعارض بين {group.length === 2 ? "جلستين" : `${group.length} جلسات`} للمحامي نفسه</p>
              <p className="text-sm text-alert/90">
                {group.map((h, i) => (
                  <span key={h.id}>
                    {i > 0 && " و "}
                    <bdi className="font-mono" dir="ltr">
                      {h.caseReference}
                    </bdi>
                  </span>
                ))}{" "}
                — {group[0].assignedLawyer.name} — بتاريخ {formatArabicDate(group[0].date)} على الساعة {group[0].time}. يُرجى مراجعة الجدول.
              </p>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {compact && (
            <Button variant="outline" onClick={() => setShowMonth((s) => !s)} aria-expanded={showMonth}>
              <CalendarDays className="h-4 w-4" />
              {showMonth ? "إخفاء الشهر" : "عرض الشهر"}
            </Button>
          )}
          {can("hearing:write") && (
            <Button onClick={() => setDialogOpen(true)} className={compact ? "flex-1" : "mr-auto"}>
              <CalendarPlus className="h-4 w-4" />
              إضافة جلسة
            </Button>
          )}
        </div>

        {compact && (
          <div className="card-elevated p-3">
            <div className="mb-2 flex items-center justify-between">
              <Button variant="ghost" size="icon" aria-label="الأسبوع السابق" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
              <p className="text-sm font-medium">
                {formatArabicDate(weekDays[0])} — {formatArabicDate(weekDays[6])}
              </p>
              <Button variant="ghost" size="icon" aria-label="الأسبوع التالي" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label="أيام الأسبوع">
              {weekDays.map((d) => {
                const iso = toISODate(d);
                const count = scheduled.filter((h) => h.date === iso).length;
                const selected = selectedDate && isSameDay(d, selectedDate);
                const urgency = count ? urgencyOf(iso) : null;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={!!selected}
                    aria-label={`${ARABIC_WEEKDAYS[d.getDay()]} ${formatArabicDate(d)}${count ? ` — ${count} جلسات` : ""}`}
                    onClick={() => selectDate(selected ? undefined : d)}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-gold bg-gold text-ink" : iso === today ? "border-gold/60" : "border-transparent",
                    )}
                  >
                    <span className={cn("text-[10px]", !selected && "text-muted-foreground")}>{ARABIC_WEEKDAYS_SHORT[d.getDay()]}</span>
                    <span className="font-mono text-sm font-medium">{d.getDate()}</span>
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", !count && "invisible", urgency === "urgent" ? "bg-alert" : urgency === "week" ? "bg-gold-deep" : "bg-muted-foreground")}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {compact && showMonth && monthCalendar}

        {/* Calendar on the start side (right in RTL); upcoming hearings + reminder settings beside it on the left. */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
          {!compact && monthCalendar}

          <div className="space-y-6">
            <Card ref={listRef} className="scroll-mt-20">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>جلسات قادمة</CardTitle>
                    <CardDescription>{selectedDate ? formatArabicDate(selectedDate) : "جميع الجلسات المبرمجة القادمة"}</CardDescription>
                  </div>
                  {selectedDate && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDate(undefined)}>
                      عرض الكل
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {hearingsQuery.isPending ? (
                  <SkeletonCards count={2} />
                ) : hearingsQuery.error ? (
                  <div role="alert" className="space-y-2">
                    <p className="text-sm text-alert">{hearingsQuery.error.message}</p>
                    <Button variant="outline" size="sm" onClick={() => void hearingsQuery.refetch()}>
                      إعادة المحاولة
                    </Button>
                  </div>
                ) : grouped.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد جلسات في هذا التاريخ.</p>
                ) : (
                  grouped.map(([date, list]) => (
                    <section key={date} aria-label={formatArabicDate(date)} className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground">
                        {ARABIC_WEEKDAYS[parseISODate(date).getDay()]} {formatArabicDate(date)}
                      </h3>
                      {list.map((h) => {
                        const urgency = urgencyOf(h.date);
                        return (
                          <div key={h.id} className={cn("rounded-[var(--radius)] border border-border p-3", h.status !== "SCHEDULED" && "opacity-75")}>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <CaseReference value={h.caseReference} />
                              {h.status === "SCHEDULED" ? (
                                <StatusBadge label={urgencyLabelOf(urgency)} tone={urgencyToneOf(urgency)} />
                              ) : (
                                <StatusBadge label={HEARING_STATUS_LABELS[h.status]} tone={h.status === "CANCELLED" ? "alert" : "neutral"} />
                              )}
                            </div>
                            <Link to={`/app/cases/${h.caseId}`} className="inline-flex items-center text-sm font-medium underline-offset-2 hover:underline coarse:min-h-11">
                              {h.clientName}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {h.type} — {h.court}
                              {h.room ? ` — ${h.room}` : ""}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                                {h.time}
                              </p>
                              <div className="flex items-center gap-1">
                                {can("task:write") && h.status === "SCHEDULED" && (
                                  <Button variant="ghost" size="sm" onClick={() => remindFor(h)} aria-label={`إنشاء تذكير لجلسة ${h.clientName}`}>
                                    <BellPlus className="h-4 w-4" />
                                    تذكير
                                  </Button>
                                )}
                                <HearingActions hearing={h} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>تذكير ذكي</CardTitle>
                <CardDescription>القنوات الافتراضية لتذكيرات الجلسات</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="ch-inapp" className="font-normal">
                    إشعار داخل التطبيق
                  </Label>
                  <Switch id="ch-inapp" checked={reminderChannels.inApp} onCheckedChange={(v) => setReminderChannels((c) => ({ ...c, inApp: v }))} />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="ch-email" className="font-normal">
                    البريد الإلكتروني
                    <span className="block text-xs text-muted-foreground">{mailConfigured ? "خدمة البريد مهيأة على الخادم" : "غير متاح: خدمة البريد غير مهيأة على الخادم"}</span>
                  </Label>
                  <Switch id="ch-email" checked={reminderChannels.email && mailConfigured} disabled={!mailConfigured} onCheckedChange={(v) => setReminderChannels((c) => ({ ...c, email: v }))} />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="ch-sms" className="font-normal">
                    SMS اختياري
                    <span className="block text-xs text-muted-foreground">غير متاح: لا يوجد مزوّد رسائل قصيرة مرتبط</span>
                  </Label>
                  <Switch id="ch-sms" checked={false} disabled />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <HearingDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultDate={selectedDate ? toISODate(selectedDate) : undefined} />
      <TaskDialog open={!!reminderDefaults} onOpenChange={(o) => !o && setReminderDefaults(undefined)} defaults={reminderDefaults} />
    </AppShell>
  );
}
