import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/status";

const toneStyles: Record<StatusTone, string> = {
  success: "bg-success/10 text-success",
  gold: "bg-gold/15 text-gold-deep",
  alert: "bg-alert/10 text-alert",
  neutral: "bg-muted text-muted-foreground",
};

const dotStyles: Record<StatusTone, string> = {
  success: "bg-success",
  gold: "bg-gold-deep",
  alert: "bg-alert",
  neutral: "bg-muted-foreground",
};

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  className?: string;
}

export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium",
        toneStyles[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotStyles[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}
