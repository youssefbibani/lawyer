import { Link } from "react-router-dom";
import { BellPlus, ChevronLeft, ChevronRight, Landmark, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { HearingActions } from "@/components/hearings/HearingActions";
import { ARABIC_WEEKDAYS, addDays, startOfDay, toISODate } from "@/lib/dates";
import { formatArabicDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { HEARING_STATUS_LABELS } from "@/backend/labels";
import type { HearingDTO } from "../../../shared/api";

/** The court week shown on the board: Monday to Saturday. */
export const BOARD_DAYS = 6;

/** Monday of the week containing `date`. */
export function mondayOf(date: Date): Date {
  const d = startOfDay(date);
  return addDays(d, -((d.getDay() + 6) % 7));
}

interface WeekBoardProps {
  weekStart: Date;
  onWeekChange: (monday: Date) => void;
  hearings: HearingDTO[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  canAdd: boolean;
  onAdd: (date: string) => void;
  canRemind: boolean;
  onRemind: (h: HearingDTO) => void;
}

/**
 * The lawyers' weekly sheet: one column per court day (Monday on the right), each hearing a card with
 * its buttons. Opens on the current week; the arrows move one week at a time.
 */
export function WeekBoard({ weekStart, onWeekChange, hearings, loading, error, onRetry, canAdd, onAdd, canRemind, onRemind }: WeekBoardProps) {
  const today = toISODate(new Date());
  const days = Array.from({ length: BOARD_DAYS }, (_, i) => addDays(weekStart, i));
  const first = toISODate(days[0]);
  const last = toISODate(days[BOARD_DAYS - 1]);
  const isCurrentWeek = toISODate(mondayOf(new Date())) === first;
  const byDay = new Map<string, HearingDTO[]>();
  for (const h of hearings) if (h.date >= first && h.date <= last) byDay.set(h.date, [...(byDay.get(h.date) ?? []), h]);
  const scheduledCount = hearings.filter((h) => h.date >= first && h.date <= last && h.status === "SCHEDULED").length;

  return (
    <section aria-label="جلسات الأسبوع" className="space-y-4">
      <div className="card-elevated flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="الأسبوع السابق" onClick={() => onWeekChange(addDays(weekStart, -7))}>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <div className="min-w-0 px-1 text-center">
            <h2 className="font-heading text-lg leading-tight">{isCurrentWeek ? "هذا الأسبوع" : "جلسات الأسبوع"}</h2>
            <p className="text-xs text-muted-foreground">
              من الإثنين {formatArabicDate(days[0])} إلى السبت {formatArabicDate(days[BOARD_DAYS - 1])}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="الأسبوع التالي" onClick={() => onWeekChange(addDays(weekStart, 7))}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{scheduledCount ? `${scheduledCount} جلسات مبرمجة` : "لا جلسات مبرمجة"}</span>
          {!isCurrentWeek && (
            <Button variant="outline" size="sm" onClick={() => onWeekChange(mondayOf(new Date()))}>
              العودة إلى هذا الأسبوع
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div role="alert" className="card-elevated space-y-2 p-4">
          <p className="text-sm text-alert">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      ) : loading ? (
        <SkeletonCards count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {days.map((d) => {
            const iso = toISODate(d);
            const list = byDay.get(iso) ?? [];
            const isToday = iso === today;
            return (
              <div
                key={iso}
                aria-label={`${ARABIC_WEEKDAYS[d.getDay()]} ${formatArabicDate(d)}`}
                role="group"
                className={cn("flex min-h-40 flex-col rounded-[var(--radius)] border bg-card xl:min-h-[28rem]", isToday ? "border-gold ring-1 ring-gold/40" : "border-border")}
              >
                <div className={cn("flex items-baseline justify-between gap-2 border-b px-3 py-2.5", isToday ? "border-gold/40 bg-gold/10" : "border-border bg-secondary/40")}>
                  <span className="font-heading text-lg leading-none">{ARABIC_WEEKDAYS[d.getDay()]}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isToday && <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[10px] font-semibold text-ink">اليوم</span>}
                    <span className="font-mono">{d.getDate()}/{d.getMonth() + 1}</span>
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-2">
                  {list.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">لا جلسات</p>}
                  {list.map((h) => (
                    <HearingCard key={h.id} hearing={h} canRemind={canRemind} onRemind={onRemind} />
                  ))}
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() => onAdd(iso)}
                      aria-label={`إضافة جلسة يوم ${ARABIC_WEEKDAYS[d.getDay()]} ${formatArabicDate(d)}`}
                      className="mt-auto flex min-h-9 items-center justify-center gap-1 rounded-[var(--radius)] border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-gold/60 hover:bg-gold/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      جلسة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HearingCard({ hearing: h, canRemind, onRemind }: { hearing: HearingDTO; canRemind: boolean; onRemind: (h: HearingDTO) => void }) {
  const scheduled = h.status === "SCHEDULED";
  return (
    <article
      aria-label={`${h.type} — ${h.clientName}`}
      className={cn(
        "space-y-2 rounded-[var(--radius)] border border-border bg-background p-2.5 shadow-sm",
        h.status === "HELD" && "border-success/40 bg-success/5",
        (h.status === "CANCELLED" || h.status === "POSTPONED") && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className={cn("min-w-0 text-sm font-semibold leading-5", h.status === "CANCELLED" && "line-through")}>{h.type}</p>
        {scheduled && canRemind && (
          <Button variant="ghost" size="icon" className="-m-1 h-7 w-7 shrink-0 text-muted-foreground coarse:h-10 coarse:w-10" onClick={() => onRemind(h)} aria-label={`إنشاء تذكير لجلسة ${h.clientName}`} title="تذكير">
            <BellPlus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1 text-xs">
        <p>
          <span className="text-muted-foreground">المنوب: </span>
          <Link to={`/app/cases/${h.caseId}`} className="font-semibold text-gold-deep underline-offset-2 hover:underline">
            {h.clientName}
          </Link>
        </p>
        <p className="flex items-start gap-1 text-gold-deep">
          <Landmark className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {h.court}
            {h.room ? ` — ${h.room}` : ""}
          </span>
        </p>
        <CaseReference value={h.caseReference} />
      </div>

      {!scheduled && <StatusBadge label={h.status === "HELD" ? "مسلّم" : HEARING_STATUS_LABELS[h.status]} tone={h.status === "HELD" ? "success" : h.status === "CANCELLED" ? "alert" : "neutral"} />}

      <HearingActions hearing={h} variant="board" />
    </article>
  );
}
