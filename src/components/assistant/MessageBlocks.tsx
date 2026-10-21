import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, BookOpenCheck, ChevronLeft, FileDown, Info, Lightbulb, PenLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CitationLink } from "@/components/assistant/CitationLink";
import { saveBrief } from "@/services/api";
import { getDB } from "@/services/db";
import type { AssistantBlock } from "@/services/assistant/types";
import type { Brief, BriefItemKind } from "@/types";

export const KIND_META: Record<BriefItemKind, { label: string; className: string }> = {
  source: { label: "مقتبس من مصدر", className: "border-success/40 bg-success/10 text-success" },
  generated: { label: "اقتراح آلي", className: "border-gold/50 bg-gold/10 text-gold-deep" },
  missing: { label: "ناقص", className: "border-alert/40 bg-alert/10 text-alert" },
  verify: { label: "يحتاج تحققاً", className: "border-alert/40 bg-alert/5 text-alert" },
  lawyer: { label: "من إضافة المحامي", className: "border-border bg-muted text-foreground" },
};

function persistBrief(brief: Brief): string | null {
  const existing = getDB().briefs.find((b) => b.id === brief.id);
  if (existing) return existing.id;
  const result = saveBrief(brief);
  if (!result.ok) {
    toast.error(result.error);
    return null;
  }
  return result.data.id;
}

function BriefPreview({ brief }: { brief: Brief }) {
  const navigate = useNavigate();
  const counts = brief.sections.flatMap((s) => s.items).reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1;
    return acc;
  }, {});
  const open = (print = false) => {
    const id = persistBrief(brief);
    if (id) navigate(`/app/assistant/briefs/${id}${print ? "?print=1" : ""}`);
  };
  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-gold/40 bg-background p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-heading text-base leading-snug">{brief.title}</p>
          <p className="text-xs text-muted-foreground">مسودة غير مراجعة — {brief.sections.length} أقسام</p>
        </div>
      </div>
      <ol className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {brief.sections.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-2 rounded-sm bg-muted/50 px-2 py-1.5">
            <span className="min-w-0 truncate">
              <span className="ml-1 font-mono text-xs text-muted-foreground">{i + 1}.</span>
              {s.title}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.items.length}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {(Object.keys(KIND_META) as BriefItemKind[])
          .filter((k) => counts[k])
          .map((k) => (
            <span key={k} className={cn("rounded-sm border px-1.5 py-0.5", KIND_META[k].className)}>
              {KIND_META[k].label}: {counts[k]}
            </span>
          ))}
      </div>
      <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
        <Button size="sm" onClick={() => open(false)}>
          <PenLine className="h-4 w-4" />
          فتح المسودة وتحريرها
        </Button>
        <Button size="sm" variant="outline" onClick={() => open(true)}>
          <FileDown className="h-4 w-4" />
          تصدير PDF
        </Button>
      </div>
    </div>
  );
}

export function MessageBlock({ block }: { block: AssistantBlock }) {
  switch (block.type) {
    case "text":
      return <p className="whitespace-pre-line text-sm leading-7">{block.text}</p>;

    case "sources":
      return (
        <section aria-label={block.title} className="space-y-2 rounded-[var(--radius)] border border-success/30 bg-success/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {block.title}
          </p>
          <ul className="space-y-2">
            {block.citations.map((c, i) => (
              <li key={`${c.documentId}-${c.page}-${i}`} className="space-y-1">
                <CitationLink citation={c} />
                {c.excerpt && (
                  <blockquote className="break-anywhere border-r-2 border-success/40 pr-2 font-legal text-xs leading-6 text-muted-foreground">«{c.excerpt}»</blockquote>
                )}
              </li>
            ))}
          </ul>
        </section>
      );

    case "suggestions":
      return (
        <section aria-label={block.title} className="space-y-2 rounded-[var(--radius)] border border-dashed border-gold/60 bg-gold/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gold-deep">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            {block.title}
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm leading-6">
            {block.items.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      );

    case "notice": {
      const Icon = block.tone === "danger" ? ShieldAlert : block.tone === "warning" ? AlertTriangle : Info;
      return (
        <p
          className={cn(
            "flex items-start gap-2 rounded-[var(--radius)] border p-2.5 text-xs leading-6",
            block.tone === "danger" && "border-alert/30 bg-alert/10 text-alert",
            block.tone === "warning" && "border-gold/40 bg-gold/10 text-gold-deep",
            block.tone === "info" && "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          <Icon className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{block.text}</span>
        </p>
      );
    }

    case "list":
      return (
        <section className="space-y-1.5">
          {block.title && <p className="text-xs font-semibold text-muted-foreground">{block.title}</p>}
          {block.items.length === 0 && block.empty && <p className="text-sm text-muted-foreground">{block.empty}</p>}
          <ul className="space-y-1.5">
            {block.items.map((item) => {
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="break-anywhere text-sm leading-6">{item.title}</p>
                    {item.subtitle && <p className="line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</p>}
                    {item.meta && <p className="text-xs text-muted-foreground">{item.meta}</p>}
                  </div>
                  {item.badge && <StatusBadge label={item.badge.label} tone={item.badge.tone} className="shrink-0" />}
                  {item.href && <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      to={item.href}
                      className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-border bg-background p-2.5 transition-colors hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-background p-2.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      );

    case "comparison":
      return (
        <section aria-label={block.title} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{block.title}</p>
          <div className="hidden overflow-hidden rounded-[var(--radius)] border border-border sm:block">
            <table className="w-full table-fixed text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="w-28 p-2 text-right font-medium">الجانب</th>
                  <th className="p-2 text-right font-medium">{block.currentLabel}</th>
                  <th className="p-2 text-right font-medium">{block.previousLabel}</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r) => (
                  <tr key={r.aspect} className="border-t border-border align-top">
                    <td className="p-2 font-medium">{r.aspect}</td>
                    <td className="break-anywhere p-2 leading-6">{r.current}</td>
                    <td className="break-anywhere p-2 leading-6">
                      {r.previous}
                      {r.citation && (
                        <div className="mt-1">
                          <CitationLink citation={r.citation} compact />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 sm:hidden">
            {block.rows.map((r) => (
              <li key={r.aspect} className="space-y-1.5 rounded-[var(--radius)] border border-border bg-background p-2.5 text-xs">
                <p className="font-semibold">{r.aspect}</p>
                <p className="leading-6">
                  <span className="text-muted-foreground">الحالي: </span>
                  {r.current}
                </p>
                <p className="leading-6">
                  <span className="text-muted-foreground">السابق: </span>
                  {r.previous}
                </p>
                {r.citation && <CitationLink citation={r.citation} compact />}
              </li>
            ))}
          </ul>
        </section>
      );

    case "brief":
      return <BriefPreview brief={block.brief} />;

    case "action":
      return null;
  }
}
