import { Link } from "react-router-dom";
import { Bell, Check, MoreVertical, Pencil, Repeat, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RECURRENCE_LABELS, priorityLabel, priorityTone } from "@/lib/status";
import { formatRelativeDay } from "@/lib/formatters";
import { toUiPriority, toUiRecurrence } from "@/backend/labels";
import { todayISO } from "@/backend/format";
import type { TaskDTO } from "../../../shared/api";

interface TaskItemProps {
  task: TaskDTO;
  onToggle: (task: TaskDTO, completed: boolean) => void;
  onEdit: (task: TaskDTO) => void;
  onDelete: (task: TaskDTO) => void;
  highlighted?: boolean;
  showCase?: boolean;
}

/** Delivery state as recorded by the server — never assumed. */
function channelStatus(task: TaskDTO): string[] {
  const parts: string[] = [];
  const latest = (channel: "IN_APP" | "EMAIL") => [...task.reminders].reverse().find((r) => r.channel === channel && r.status !== "CANCELLED");
  if (task.notifyInApp) {
    const r = latest("IN_APP");
    parts.push(!task.dueTime ? "داخل التطبيق: حدّد ساعة للتنبيه" : r?.status === "SENT" ? "ظهر داخل التطبيق" : "مجدول داخل التطبيق");
  }
  if (task.notifyEmail) {
    const r = latest("EMAIL");
    if (!task.dueTime) parts.push("البريد: حدّد ساعة للتنبيه");
    else if (!r || r.status === "PENDING") parts.push("البريد: مجدول");
    else if (r.status === "SENT") parts.push("البريد: أُرسل");
    else if (r.status === "NOT_CONFIGURED") parts.push("البريد: لم يُرسل (خدمة البريد غير مهيأة)");
    else if (r.status === "FAILED") parts.push("البريد: فشل الإرسال");
  }
  return parts;
}

const initials = (name: string) =>
  name
    .replace(/^(الأستاذة?|الأستاذ)\s+/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.replace(/^ال/, "")[0])
    .join(".");

export function TaskItem({ task, onToggle, onEdit, onDelete, highlighted, showCase = true }: TaskItemProps) {
  const completed = task.status === "DONE";
  const overdue = !completed && !!task.dueDate && task.dueDate < todayISO();
  const checkboxId = `task-done-${task.id}`;
  const recurrence = toUiRecurrence(task.recurrence);
  const status = !completed ? channelStatus(task) : [];

  return (
    <li
      id={`task-${task.id}`}
      className={cn("card-elevated flex items-start gap-2 p-3 transition-colors sm:gap-3 sm:p-4", highlighted && "border-gold ring-2 ring-gold/40", completed && "opacity-70")}
    >
      <label htmlFor={checkboxId} className="-m-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)]">
        <input
          id={checkboxId}
          type="checkbox"
          checked={completed}
          onChange={(e) => onToggle(task, e.target.checked)}
          className="peer sr-only"
          aria-label={completed ? `إعادة فتح: ${task.title}` : `إنجاز: ${task.title}`}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
            completed ? "border-success bg-success text-success-foreground" : overdue ? "border-alert" : "border-muted-foreground/50",
          )}
        >
          {completed && <Check className="h-3.5 w-3.5" />}
        </span>
      </label>

      <div className="min-w-0 flex-1 space-y-1.5 pt-1.5">
        <p className={cn("break-anywhere text-sm font-medium leading-6", completed && "line-through decoration-muted-foreground")}>
          {task.kind === "REMINDER" && <Bell className="ml-1 inline h-3.5 w-3.5 text-gold-deep" aria-label="تذكير" />}
          {task.title}
        </p>
        {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className={cn("font-medium", overdue && "text-alert")}>
            {overdue ? "متأخرة — " : ""}
            {task.dueDate ? formatRelativeDay(task.dueDate) : "بدون تاريخ"}
            {task.dueTime && <span className="font-mono"> {task.dueTime}</span>}
          </span>
          <StatusBadge label={priorityLabel(toUiPriority(task.priority))} tone={priorityTone(toUiPriority(task.priority))} />
          <span className="inline-flex items-center gap-1" title={task.assignee.name}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-night text-[9px] text-cream">{initials(task.assignee.name)}</span>
            {task.assignee.name}
          </span>
          {recurrence !== "none" && (
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" aria-hidden="true" />
              {RECURRENCE_LABELS[recurrence]}
            </span>
          )}
        </div>
        {showCase && task.case && (
          <Link to={`/app/cases/${task.case.id}`} className="inline-flex min-h-8 items-center gap-1.5 text-xs coarse:min-h-11 text-foreground underline-offset-2 hover:underline">
            <span className="ref-tag">{task.case.reference}</span>
            <span className="truncate">{task.case.clientName}</span>
          </Link>
        )}
        {status.length > 0 && <p className="text-[11px] text-muted-foreground/90">{status.join(" • ")}</p>}
      </div>

      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`إجراءات: ${task.title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!completed && (
            <DropdownMenuItem onSelect={() => onEdit(task)} className="min-h-11">
              <Pencil className="h-4 w-4" />
              تعديل
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onDelete(task)} className="min-h-11 text-alert focus:text-alert">
            <Trash2 className="h-4 w-4" />
            حذف
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
