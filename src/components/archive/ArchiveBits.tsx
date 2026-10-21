import { useState } from "react";
import { Check, ChevronDown, FileText, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useBlobUrl } from "@/hooks/use-blob-url";
import { STATE_LABELS, STATE_TONES, LOW_CONFIDENCE } from "@/services/archive/workflow";
import type { ArchiveItem, ArchiveItemState, FieldSource } from "@/types";

export function ItemStateBadge({ state, className }: { state: ArchiveItemState; className?: string }) {
  return <StatusBadge label={STATE_LABELS[state]} tone={STATE_TONES[state]} className={className} />;
}

export function ConfidenceBadge({ value, source }: { value: number; source?: FieldSource }) {
  if (source === "human") {
    return <span className="inline-flex items-center gap-1 rounded-sm bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">مصحّح يدوياً</span>;
  }
  const low = value < LOW_CONFIDENCE;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium",
        low ? "bg-alert/10 text-alert" : value < 80 ? "bg-gold/15 text-gold-deep" : "bg-success/10 text-success",
      )}
      title="درجة الثقة"
    >
      {low && "غير مؤكد · "}
      {value}%
    </span>
  );
}

export const SOURCE_LABELS: Record<FieldSource, string> = {
  ocr: "من النص المستخرج",
  rule: "استخراج آلي من النص",
  human: "مصحّح يدوياً",
  assistant: "اقتراح المساعد",
};

export function PageThumb({ thumbKey, rotation = 0, label, className }: { thumbKey?: string; rotation?: number; label: string; className?: string }) {
  const { url, missing } = useBlobUrl(thumbKey);
  return (
    <div className={cn("flex aspect-[3/4] items-center justify-center overflow-hidden rounded-sm border border-border bg-muted", className)}>
      {url ? (
        <img src={url} alt={label} className="h-full w-full object-cover transition-transform" style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }} />
      ) : missing ? (
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-label="المعاينة غير متاحة" />
      ) : (
        <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

export function itemThumbKey(item: ArchiveItem): string | undefined {
  return [...item.pages].sort((a, b) => a.index - b.index)[0]?.thumbKey;
}

export interface StepDef {
  key: string;
  label: string;
  count?: number;
  done?: boolean;
}

/** Horizontal stepper on desktop, collapsible vertical stepper on phones. */
export function ArchiveStepper({ steps, current, onSelect }: { steps: StepDef[]; current: string; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const index = steps.findIndex((s) => s.key === current);
  const item = (s: StepDef, i: number, vertical: boolean) => {
    const active = s.key === current;
    return (
      <li key={s.key} className={cn(vertical ? "" : "flex min-w-0 flex-1 items-center")}>
        <button
          type="button"
          onClick={() => {
            onSelect(s.key);
            setOpen(false);
          }}
          aria-current={active ? "step" : undefined}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-[var(--radius)] px-2 text-right text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "bg-gold/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary",
          )}
        >
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
              s.done ? "border-success bg-success/15 text-success" : active ? "border-gold bg-gold/20 text-gold-deep" : "border-border",
            )}
          >
            {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className="min-w-0 flex-1 leading-snug">{s.label}</span>
          {s.count !== undefined && s.count > 0 && <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{s.count}</span>}
        </button>
      </li>
    );
  };
  return (
    <nav aria-label="مراحل الأرشفة">
      <ol className="hidden gap-1 lg:flex">{steps.map((s, i) => item(s, i, false))}</ol>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="card-elevated flex min-h-12 w-full items-center justify-between gap-2 px-3 text-right"
        >
          <span className="text-sm">
            <span className="text-muted-foreground">المرحلة {index + 1} من {steps.length}: </span>
            <span className="font-semibold">{steps[index]?.label}</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {open && <ol className="card-elevated mt-2 space-y-1 p-2">{steps.map((s, i) => item(s, i, true))}</ol>}
      </div>
    </nav>
  );
}
