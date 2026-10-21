import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, FileDown, FileQuestion, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CitationLink } from "@/components/assistant/CitationLink";
import { KIND_META } from "@/components/assistant/MessageBlocks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { deleteBrief, findAccessibleCase, getMember, saveBrief } from "@/services/api";
import { dedupeCitations } from "@/services/assistant/brief";
import { newId } from "@/services/db";
import { formatArabicDate } from "@/lib/formatters";
import { printElement } from "@/lib/print";
import type { Brief, BriefItem, BriefItemKind } from "@/types";

function AutoTextarea({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      dir="auto"
      className="w-full resize-none overflow-hidden rounded-[var(--radius)] border border-transparent bg-transparent px-2 py-1.5 font-legal text-base leading-7 hover:border-border focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20 md:text-sm"
    />
  );
}

export default function BriefEditor() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const db = useDB();
  const user = useCurrentUser();
  const stored = db.briefs.find((b) => b.id === id);
  const legalCase = findAccessibleCase(stored?.caseId, db, user);
  const [brief, setBrief] = useState<Brief | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const canReview = user.role === "lawyer" || user.role === "associate";

  useEffect(() => {
    if (stored && !dirty) setBrief(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.updatedAt]);

  // Warn before closing / reloading the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const hearing = db.hearings.find((h) => h.id === brief?.hearingId);
  const allCitations = useMemo(() => dedupeCitations(brief?.sections.flatMap((s) => s.items.flatMap((i) => i.citations)) ?? []), [brief]);

  useEffect(() => {
    if (params.get("print") === "1" && brief && printRef.current) {
      setParams({}, { replace: true });
      setTimeout(() => printRef.current && printElement(printRef.current, brief.title), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief?.id]);

  if (!brief || !legalCase) {
    return (
      <AppShell title="المذكرة التحضيرية" backTo="/app/assistant">
        <EmptyState
          icon={FileQuestion}
          title="المسودة غير متاحة"
          description="قد تكون المسودة محذوفة أو مرتبطة بملف غير مصرّح لك به."
          action={<Button onClick={() => navigate("/app/assistant")}>العودة إلى المساعد</Button>}
        />
      </AppShell>
    );
  }

  const update = (fn: (b: Brief) => Brief) => {
    setBrief((b) => (b ? fn(b) : b));
    setDirty(true);
  };
  const updateItem = (sectionKey: string, itemId: string, patch: Partial<BriefItem>) =>
    update((b) => ({
      ...b,
      reviewed: false,
      sections: b.sections.map((s) => (s.key === sectionKey ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : s)),
    }));
  const removeItem = (sectionKey: string, itemId: string) =>
    update((b) => ({ ...b, sections: b.sections.map((s) => (s.key === sectionKey ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s)) }));
  const addItem = (sectionKey: string) =>
    update((b) => ({
      ...b,
      sections: b.sections.map((s) => (s.key === sectionKey ? { ...s, items: [...s.items, { id: newId("bi"), kind: "lawyer", text: "", citations: [] }] } : s)),
    }));

  function save(): boolean {
    if (!brief) return false;
    const result = saveBrief(brief);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setDirty(false);
    toast.success("تم حفظ المسودة", { description: "محفوظة محلياً في هذا المتصفح." });
    return true;
  }

  function exportPdf() {
    if (dirty && !save()) return;
    if (printRef.current) printElement(printRef.current, brief!.title);
  }

  const kindBadge = (kind: BriefItemKind, edited?: boolean) => (
    <span className={cn("inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium", KIND_META[kind].className)}>
      {KIND_META[kind].label}
      {edited && kind !== "lawyer" ? " — معدّل" : ""}
    </span>
  );

  return (
    <AppShell title="المذكرة التحضيرية" subtitle={`${legalCase.client} — ${legalCase.ref}`} backTo="/app/assistant">
      <div className="mx-auto max-w-4xl space-y-5 pb-24 lg:pb-0">
        <div className="space-y-3">
          <div className="font-heading text-xl sm:text-2xl [&_textarea]:font-heading [&_textarea]:text-xl sm:[&_textarea]:text-2xl">
            <AutoTextarea label="عنوان المذكرة" value={brief.title} onChange={(title) => update((b) => ({ ...b, title }))} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Link to={`/app/cases/${legalCase.id}`} className="underline-offset-2 hover:underline">
              ملف {legalCase.client}
            </Link>
            {hearing && (
              <span>
                {hearing.type} — {formatArabicDate(hearing.date)} {hearing.time}
              </span>
            )}
            <span>أُعدّت {formatArabicDate(brief.createdAt.slice(0, 10))}</span>
            {dirty && <span className="text-gold-deep">تغييرات غير محفوظة</span>}
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-3 text-sm leading-7 text-gold-deep">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
          مسودة عمل داخلية مولّدة آلياً — ليست رأياً قانونياً معتمداً. العناصر الموسومة «مقتبس من مصدر» منقولة من وثائق الملف مع إحالتها؛ بقية العناصر اقتراحات يجب التحقق منها. لا تتضمن المسودة أي فصل قانوني أو حكم غير موجود في الأرشيف.
        </p>

        <div className="flex flex-wrap gap-1.5 text-[11px]" aria-label="دليل الوسوم">
          {(Object.keys(KIND_META) as BriefItemKind[]).map((k) => (
            <span key={k}>{kindBadge(k)}</span>
          ))}
        </div>

        <ol className="space-y-4">
          {brief.sections.map((section, si) => (
            <li key={section.key} className="card-elevated p-3 sm:p-5">
              <h2 className="mb-3 flex items-baseline gap-2 font-heading text-lg">
                <span className="font-mono text-sm text-muted-foreground">{si + 1}.</span>
                {section.title}
              </h2>
              {section.items.length === 0 && <p className="mb-2 text-sm text-muted-foreground">لا توجد عناصر في هذا القسم.</p>}
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li key={item.id} className="space-y-1.5 border-r-2 border-border pr-2 sm:pr-3">
                    <div className="flex items-center justify-between gap-2">
                      {kindBadge(item.kind, item.edited)}
                      <button
                        type="button"
                        aria-label="حذف العنصر"
                        onClick={() => removeItem(section.key, item.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-alert coarse:h-11 coarse:w-11"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <AutoTextarea
                      label={`${section.title}: عنصر`}
                      value={item.text}
                      onChange={(text) => updateItem(section.key, item.id, { text, edited: true })}
                    />
                    {item.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.citations.map((c, i) => (
                          <CitationLink key={`${c.documentId}-${c.page}-${i}`} citation={c} compact />
                        ))}
                      </div>
                    )}
                    {item.kind === "source" && item.edited && (
                      <p className="text-[11px] text-alert">عُدّل نص مقتبس: تأكد من مطابقته للمصدر قبل استعماله.</p>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => addItem(section.key)}>
                <Plus className="h-4 w-4" />
                إضافة نقطة
              </Button>
            </li>
          ))}
        </ol>

        <div className="card-elevated space-y-3 p-4">
          <label className={cn("flex items-start gap-3 text-sm", canReview ? "cursor-pointer" : "opacity-60")}>
            <Checkbox
              checked={brief.reviewed}
              disabled={!canReview}
              onCheckedChange={(v) => update((b) => ({ ...b, reviewed: v === true, reviewedAt: v === true ? new Date().toISOString() : undefined }))}
              className="mt-1"
            />
            <span className="leading-6">
              راجعتُ هذه المسودة بصفتي المحامي المسؤول وأتحمّل مسؤولية أي استعمال لها.
              {!canReview && <span className="block text-xs text-muted-foreground">المراجعة متاحة للمحامين فقط.</span>}
              {brief.reviewed && brief.reviewedAt && (
                <span className="block text-xs text-success">
                  تمت المراجعة — {getMember(user.id)?.name} — {formatArabicDate(brief.reviewedAt.slice(0, 10))}
                </span>
              )}
            </span>
          </label>
        </div>

        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto grid max-w-4xl grid-cols-3 gap-2 lg:flex lg:justify-start">
            <Button onClick={save} disabled={!dirty}>
              <Save className="h-4 w-4" />
              حفظ
            </Button>
            <Button variant="outline" onClick={exportPdf}>
              <FileDown className="h-4 w-4" />
              PDF
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-alert">
              <Trash2 className="h-4 w-4" />
              حذف
            </Button>
          </div>
        </div>
      </div>

      {/* Print layout (rendered off-screen, printed through an iframe). */}
      <div className="hidden">
        <div ref={printRef} dir="rtl" lang="ar" className="space-y-4 p-2 font-legal text-[12pt] leading-7 text-ink">
          <header className="space-y-1 border-b border-ink/20 pb-3">
            <p className="font-heading text-xl">{brief.title}</p>
            <p className="text-sm">
              الملف: {legalCase.client} — {legalCase.ref} — {legalCase.court}
            </p>
            <p className="text-sm font-semibold">
              مسودة عمل داخلية — ليست رأياً قانونياً معتمداً — {brief.reviewed ? "تمت مراجعتها من طرف المحامي" : "لم تتم مراجعتها بعد"}
            </p>
          </header>
          {brief.sections.map((s, si) => (
            <section key={s.key} className="print-break-avoid space-y-1.5">
              <h2 className="font-heading text-lg">
                {si + 1}. {s.title}
              </h2>
              <ul className="space-y-1.5">
                {s.items.map((i) => (
                  <li key={i.id}>
                    <span className="text-[9pt] font-semibold">[{KIND_META[i.kind].label}]</span> {i.text}
                    {i.citations.length > 0 && (
                      <span className="text-[9pt]"> — {i.citations.map((c) => `${c.title}${c.page ? `، ص ${c.page}` : ""}`).join("؛ ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="print-break-avoid border-t border-ink/20 pt-3 text-[10pt]">
            <p className="font-semibold">قائمة المصادر المسترجعة</p>
            <ul>
              {allCitations.map((c) => (
                <li key={`${c.documentId}-${c.page}`}>
                  {c.title}
                  {c.page ? ` — الصفحة ${c.page}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="حذف المسودة"
        description="سيتم حذف هذه المذكرة التحضيرية نهائياً."
        confirmLabel="حذف"
        tone="destructive"
        onConfirm={() => {
          const r = deleteBrief(brief.id);
          if (r.ok) {
            setDirty(false);
            toast.success("تم حذف المسودة");
            setTimeout(() => navigate("/app/assistant"), 0);
          } else toast.error(r.error);
        }}
      />
      <span className="sr-only" aria-live="polite">
        {brief.reviewed ? "تمت مراجعة المسودة" : ""}
      </span>
    </AppShell>
  );
}
