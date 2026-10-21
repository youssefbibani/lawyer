import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ARABIC_WEEKDAYS, ARABIC_WEEKDAYS_SHORT, toISODate, urgencyOf } from "@/lib/dates";
import { arabicMonths, formatArabicDate } from "@/lib/formatters";
import { urgencyLabelOf } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { HearingDTO } from "../../../shared/api";

type Urgency = ReturnType<typeof urgencyOf>;

/** Hearings shown per day before collapsing into "+N". */
const MAX_CHIPS = 3;

const CHIP_TONE: Record<Urgency, string> = {
  urgent: "border-alert/30 bg-alert/10 text-alert",
  week: "border-gold/40 bg-gold/10 text-gold-deep dark:text-gold",
  later: "border-border bg-muted text-foreground/80",
  past: "border-border bg-muted text-foreground/60",
};

const DOT_TONE: Record<Urgency, string> = {
  urgent: "bg-alert",
  week: "bg-gold",
  later: "bg-muted-foreground",
  past: "bg-muted-foreground/50",
};

const LEGEND: { label: string; hint: string; dot: string }[] = [
  { label: "عاجل", hint: "أقل من 48 ساعة", dot: "bg-alert" },
  { label: "هذا الأسبوع", hint: "خلال 7 أيام", dot: "bg-gold" },
  { label: "لاحقاً", hint: "بعد أكثر من أسبوع", dot: "bg-muted-foreground" },
];

/** Weeks as rows of 7 (Sunday first); days outside the month are `null` so the last row is always complete. */
function monthWeeks(month: Date): (Date | null)[][] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const lead = new Date(year, m, 1).getDay();
  const days = new Date(year, m + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(year, m, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** "CC/2025/0842" → "0842": enough to recognise the file at a glance; the full reference is in the tooltip. */
const shortReference = (reference: string) => reference.split("/").pop() || reference;

export interface MonthCalendarProps {
  /** Any date inside the month to display. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** Hearings to plot; the component groups them by day. */
  hearings: HearingDTO[];
  selectedDate?: Date;
  /** Called with the day to select, or `undefined` when the selected day is clicked again. */
  onSelectDate: (date: Date | undefined) => void;
  loadFailed?: boolean;
  className?: string;
}

export function MonthCalendar({ month, onMonthChange, hearings, selectedDate, onSelectDate, loadFailed, className }: MonthCalendarProps) {
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, HearingDTO[]>();
    for (const h of hearings) map.set(h.date, [...(map.get(h.date) ?? []), h]);
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [hearings]);

  const todayISO = toISODate(new Date());
  const selectedISO = selectedDate ? toISODate(selectedDate) : undefined;
  const shiftMonth = (delta: number) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const isCurrentMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  return (
    <section aria-label="تقويم الجلسات" className={cn("card-elevated overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="icon" aria-label="الشهر السابق" onClick={() => shiftMonth(-1)}>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <h3 className="min-w-[8.5rem] text-center font-heading text-xl font-bold leading-tight" aria-live="polite">
            {arabicMonths[month.getMonth()]} {month.getFullYear()}
          </h3>
          <Button variant="ghost" size="icon" aria-label="الشهر التالي" onClick={() => shiftMonth(1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          {!isCurrentMonth && (
            <Button variant="outline" size="sm" onClick={() => onMonthChange(new Date())}>
              اليوم
            </Button>
          )}
        </div>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="دلالة الألوان">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5" title={item.hint}>
              <span className={cn("h-2 w-2 rounded-full", item.dot)} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </header>

      {loadFailed && <p className="border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">تعذّر تحميل الجلسات، لذلك قد يبدو التقويم فارغاً.</p>}

      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {ARABIC_WEEKDAYS_SHORT.map((name, i) => (
              <th key={name} scope="col" abbr={ARABIC_WEEKDAYS[i]} className="border-b border-border px-1 py-2.5 text-[11px] font-normal text-muted-foreground sm:text-sm">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                if (!day) return <td key={i} aria-hidden="true" className="border-b border-l border-border bg-muted/30 p-0 last:border-l-0" />;

                const iso = toISODate(day);
                const list = byDay.get(iso) ?? [];
                const selected = iso === selectedISO;
                const isToday = iso === todayISO;
                const shown = list.slice(0, MAX_CHIPS);
                const hidden = list.length - shown.length;
                const label = `${ARABIC_WEEKDAYS[day.getDay()]} ${formatArabicDate(day)}${list.length ? ` — ${list.length === 1 ? "جلسة واحدة" : `${list.length} جلسات`}` : ""}`;

                return (
                  <td key={i} className="border-b border-l border-border p-0 align-top last:border-l-0">
                    <div className={cn("hearing-cell relative flex min-h-[4.25rem] flex-col gap-1 p-1 sm:min-h-[7.5rem] sm:gap-1.5 sm:p-1.5", selected && "bg-gold/10 ring-2 ring-inset ring-gold")}>
                      {/* Stretched button: the whole cell selects the day; hearing links sit above it. */}
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={label}
                        onClick={() => onSelectDate(selected ? undefined : day)}
                        className="absolute inset-0 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      />

                      <span
                        aria-hidden="true"
                        className={cn(
                          "pointer-events-none relative grid h-6 min-w-6 place-items-center self-start rounded-full px-1 text-xs tabular-nums sm:text-sm",
                          isToday ? "bg-gold font-semibold text-ink" : "text-muted-foreground",
                        )}
                      >
                        {day.getDate()}
                      </span>

                      {/* Phones: one dot per hearing; the list below carries the detail. */}
                      {list.length > 0 && (
                        <span aria-hidden="true" className="pointer-events-none relative flex flex-wrap gap-0.5 sm:hidden">
                          {shown.map((h) => (
                            <span key={h.id} className={cn("h-1.5 w-1.5 rounded-full", DOT_TONE[urgencyOf(h.date)])} />
                          ))}
                        </span>
                      )}

                      {shown.map((h) => (
                        <Link
                          key={h.id}
                          to={`/app/cases/${h.caseId}`}
                          title={`${h.type} — ${h.clientName} — ${h.time} — ${h.caseReference} — ${urgencyLabelOf(urgencyOf(h.date))}`}
                          aria-label={`${h.type} — ${h.clientName} — الساعة ${h.time} — ${h.caseReference} — ${urgencyLabelOf(urgencyOf(h.date))}`}
                          className={cn(
                            "relative z-10 hidden flex-wrap items-center justify-center gap-x-1 rounded-sm border px-1 py-0.5 font-mono text-[11px] leading-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex [&>span]:whitespace-nowrap",
                            CHIP_TONE[urgencyOf(h.date)],
                          )}
                          dir="ltr"
                        >
                          <span>{shortReference(h.caseReference)}</span>
                          <span className="hearing-chip-sep" aria-hidden="true">
                            —
                          </span>
                          <span>{h.time}</span>
                        </Link>
                      ))}

                      {hidden > 0 && (
                        <span className="pointer-events-none relative hidden text-center text-[11px] text-muted-foreground sm:block">+{hidden} أخرى</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
