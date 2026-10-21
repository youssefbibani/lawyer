import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, BellRing, CalendarClock, ListTodo } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/backend/http";
import { useConflictGroups, useDashboard, useInbox, useTaskSummary } from "@/backend/queries";
import { addDaysToISO } from "@/backend/dates";
import { formatRelativeDay } from "@/lib/formatters";
import { useHasBackend } from "@/backend/optional";

export function NotificationsMenu() {
  return useHasBackend() ? <BackendNotificationsMenu /> : <EmptyNotificationsMenu />;
}

function BellButton({ count }: { count: number }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={count ? `الإشعارات: ${count} عناصر تتطلب الانتباه` : "الإشعارات"}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-alert" aria-hidden="true" />}
      </button>
    </DropdownMenuTrigger>
  );
}

/** Without a backend connection there is nothing to report (never invented). */
function EmptyNotificationsMenu() {
  return (
    <DropdownMenu dir="rtl">
      <BellButton count={0} />
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel>تنبيهات تتطلب انتباهك</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">لا توجد تنبيهات حالياً.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BackendNotificationsMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inbox = useInbox();
  const dashboard = useDashboard();
  const conflicts = useConflictGroups();
  const summary = useTaskSummary();

  const soon = useMemo(() => {
    const today = dashboard.data?.today;
    if (!today) return [];
    const limit = addDaysToISO(today, 2);
    return (dashboard.data?.hearingsNext7Days ?? []).filter((h) => h.date <= limit);
  }, [dashboard.data]);

  const reminders = inbox.data?.items ?? [];
  const groups = conflicts.data ?? [];
  const dueToday = summary.data?.today ?? 0;
  const overdue = summary.data?.overdue ?? 0;
  const count = reminders.length + soon.length + groups.length + (dueToday || overdue ? 1 : 0);

  function openReminder(id: string, taskId: string | null) {
    void api.post(`/reminders/${id}/read`).then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }));
    navigate(taskId ? `/app/tasks?focus=${taskId}` : "/app/agenda");
  }

  return (
    <DropdownMenu dir="rtl">
      <BellButton count={count} />
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel>تنبيهات تتطلب انتباهك</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {count === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">لا توجد تنبيهات حالياً.</p>}
        {reminders.map((r) => (
          <DropdownMenuItem key={r.id} onSelect={() => openReminder(r.id, r.taskId)} className="min-h-11 items-start">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
            <span className="min-w-0 text-sm">{r.title}</span>
          </DropdownMenuItem>
        ))}
        {groups.map((g) => (
          <DropdownMenuItem key={g[0].id} onSelect={() => navigate("/app/agenda")} className="min-h-11 items-start">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
            <span className="min-w-0 text-sm">
              تعارض بين {g.length} جلسات — {formatRelativeDay(g[0].date)} {g[0].time}
            </span>
          </DropdownMenuItem>
        ))}
        {soon.map((h) => (
          <DropdownMenuItem key={h.id} onSelect={() => navigate("/app/agenda")} className="min-h-11 items-start">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
            <span className="min-w-0 text-sm">
              {h.type} — {h.clientName} <span className="text-muted-foreground">({formatRelativeDay(h.date)} {h.time})</span>
            </span>
          </DropdownMenuItem>
        ))}
        {(dueToday > 0 || overdue > 0) && (
          <DropdownMenuItem onSelect={() => navigate("/app/tasks")} className="min-h-11 items-start">
            <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
            <span className="min-w-0 text-sm">
              {dueToday} مهام لليوم
              {overdue > 0 && <span className="text-alert"> • {overdue} متأخرة</span>}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
