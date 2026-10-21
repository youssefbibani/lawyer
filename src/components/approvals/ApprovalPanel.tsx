import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Bot, FileText, ShieldCheck, UserCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProposedChange } from "@/types";

export type PanelTone = "pending" | "success" | "danger" | "muted";

interface ApprovalPanelProps {
  title: string;
  caseLabel?: string;
  details?: string;
  changes: ProposedChange[];
  warnings?: string[];
  approver: string;
  statusLabel: string;
  tone: PanelTone;
  proposedBy?: string;
  viaAssistant?: boolean;
  children?: ReactNode;
  className?: string;
}

const TONES: Record<PanelTone, { border: string; badge: string }> = {
  pending: { border: "border-gold/50", badge: "bg-gold/15 text-gold-deep" },
  success: { border: "border-success/40", badge: "bg-success/15 text-success" },
  danger: { border: "border-alert/40", badge: "bg-alert/15 text-alert" },
  muted: { border: "border-border", badge: "bg-muted text-muted-foreground" },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 xs:grid-cols-[8.5rem_minmax(0,1fr)] xs:gap-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Reusable Arabic approval card: what will change, for which file, who must approve, status. */
export function ApprovalPanel({
  title,
  caseLabel,
  details,
  changes,
  warnings = [],
  approver,
  statusLabel,
  tone,
  proposedBy,
  viaAssistant,
  children,
  className,
}: ApprovalPanelProps) {
  const t = TONES[tone];
  return (
    <section aria-label={`طلب موافقة: ${title}`} className={cn("space-y-3 rounded-[var(--radius)] border bg-background p-3 sm:p-4", t.border, className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-gold-deep" aria-hidden="true" />
          طلب موافقة
        </p>
        <span className={cn("rounded-sm px-2 py-0.5 text-[11px] font-medium", t.badge)} role="status">
          {statusLabel}
        </span>
      </header>
      <dl className="space-y-2.5">
        <Row label="العملية المقترحة">
          <span className="font-medium">{title}</span>
          {viaAssistant && (
            <span className="mr-2 inline-flex items-center gap-1 rounded-sm border border-gold/40 px-1.5 text-[10px] text-gold-deep">
              <Bot className="h-3 w-3" aria-hidden="true" />
              اقتراح من المساعد
            </span>
          )}
        </Row>
        <Row label="الملف المعني">{caseLabel ?? <span className="text-muted-foreground">غير مرتبط بقضية</span>}</Row>
        {details && (
          <Row label="التفاصيل">
            <span className="whitespace-pre-line leading-6">{details}</span>
          </Row>
        )}
        <Row label="التغييرات المقترحة">
          {changes.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="space-y-1.5">
              {changes.map((c, i) => (
                <li key={`${c.label}-${i}`} className="rounded-sm bg-muted/50 px-2 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">{c.label}: </span>
                  {c.before !== undefined && (
                    <>
                      <span className="text-muted-foreground line-through decoration-alert/60">{c.before}</span>
                      <ArrowLeft className="mx-1 inline h-3 w-3 text-muted-foreground" aria-label="يصبح" />
                    </>
                  )}
                  <span className="break-anywhere whitespace-pre-line font-medium">{c.after}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="الشخص المخوّل بالموافقة">
          <span className="inline-flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {approver}
          </span>
        </Row>
        {proposedBy && (
          <Row label="مقدّم الطلب">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {proposedBy}
            </span>
          </Row>
        )}
      </dl>
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-2.5 text-xs text-alert">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
