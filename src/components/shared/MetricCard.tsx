import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface MetricCardProps {
  icon: LucideIcon;
  value: string;
  label: string;
  hint?: string;
  tone?: "default" | "alert" | "gold";
}

const toneStyles = {
  default: { icon: "text-foreground bg-foreground/5", value: "text-foreground" },
  alert: { icon: "text-alert bg-alert/10", value: "text-alert" },
  gold: { icon: "text-gold-deep bg-gold/15", value: "text-gold-deep" },
};

export function MetricCard({ icon: Icon, value, label, hint, tone = "default" }: MetricCardProps) {
  const styles = toneStyles[tone];
  return (
    <div className="stat-card h-full animate-fade-in p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("whitespace-nowrap font-mono font-medium leading-tight", value.length > 6 ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl", styles.value)}>
            {value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
          {hint && <p className="mt-2 text-xs text-muted-foreground/80">{hint}</p>}
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] sm:h-10 sm:w-10", styles.icon)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
