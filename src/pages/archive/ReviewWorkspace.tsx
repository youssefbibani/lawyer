import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Expand,
  FileQuestion,
  Keyboard,
  Loader2,
  RotateCcw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfidenceBadge, ItemStateBadge, PageThumb, SOURCE_LABELS } from "@/components/archive/ArchiveBits";
import { AssistantShortcuts, CaseMatchPanel, DuplicatesPanel } from "@/components/archive/ArchivePanels";
import { ApprovalRequestCard } from "@/components/approvals/ApprovalRequestCard";
import { highlightText } from "@/components/documents/highlight";
import { useDB } from "@/hooks/use-db";
import { useBlobUrl } from "@/hooks/use-blob-url";
import { useMediaQuery } from "@/hooks/use-media-query";
import { batchItems, findItem, resubmitItem, returnForCorrection, saveReview } from "@/services/archive/service";
import { openRequestFor, submitVerification, uncertainFields, withdrawVerification } from "@/services/archive/actions";
import { CATEGORY_LABELS, LOW_CONFIDENCE } from "@/services/archive/workflow";
import type { ArchiveCategory, ArchiveItem, ArchivePage, ExtractedField } from "@/types";

const FIELD_DEFS: { key: ExtractedField["key"]; label: string; type: "text" | "date" }[] = [
  { key: "title", label: "عنوان الوثيقة", type: "text" },
  { key: "caseRef", label: "مرجع القضية", type: "text" },
  { key: "date", label: "التاريخ", type: "date" },
  { key: "court", label: "المحكمة", type: "text" },
  { key: "parties", label: "الأطراف", type: "text" },
  { key: "client", label: "الحريف", type: "text" },
];

const TABS = ["data", "text", "duplicates", "case", "assistant"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { data: "البيانات", text: "النص", duplicates: "التكرارات", case: "القضية", assistant: "المساعد" };

interface FormState {
  values: Record<string, string>;
  corrected: Record<string, string>;
  category: ArchiveCategory;
}

function formFrom(item: ArchiveItem): FormState {
  return {
    values: Object.fromEntries(FIELD_DEFS.map((d) => [d.key, item.fields.find((f) => f.key === d.key)?.value ?? ""])),
    corrected: Object.fromEntries(item.pages.map((p) => [p.id, p.correctedText ?? p.ocr?.text ?? ""])),
    category: item.classification?.final ?? item.classification?.suggested ?? "other",
  };
}

function PagePreview({ page, zoom, className }: { page?: ArchivePage; zoom: number; className?: string }) {
  const { url, missing } = useBlobUrl(page?.originalKey);
  return (
    <div className={cn("overflow-auto rounded-[var(--radius)] border border-border bg-muted/40", className)}>
      {url ? (
        <img
          src={url}
          alt={`صورة الصفحة ${(page?.index ?? 0) + 1}`}
          className="mx-auto block max-w-none origin-top transition-transform"
          style={{ width: `${zoom}%`, transform: page?.rotation ? `rotate(${page.rotation}deg)` : undefined }}
        />
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">{missing ? "تعذّر تحميل صورة الصفحة من التخزين المحلي." : "جارٍ تحميل الصفحة..."}</p>
      )}
    </div>
  );
}

export default function ReviewWorkspace() {
  const { batchId = "", itemId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const db = useDB();
  const item = findItem(itemId, db);
  const batch = db.batches.find((b) => b.id === batchId);
  const queue = useMemo(() => batchItems(batchId, db).filter((i) => i.state !== "archived").sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [batchId, db]);
  const position = queue.findIndex((i) => i.id === itemId);
  const desktop = useMediaQuery("(min-width: 1024px)");

  const [form, setForm] = useState<FormState | null>(item ? formFrom(item) : null);
  const [baseVersion, setBaseVersion] = useState(item?.version ?? 0);
  const [conflict, setConflict] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [help, setHelp] = useState(false);
  const [fullView, setFullView] = useState(false);
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "data") as Tab;
  const pages = item ? [...item.pages].sort((a, b) => a.index - b.index) : [];
  const pageIdx = Math.min(Math.max(0, Number(params.get("page") ?? 1) - 1), Math.max(0, pages.length - 1));
  const setParam = (k: string, v: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set(k, v);
    return next;
  }, { replace: true });

  const dirty = !!(item && form && JSON.stringify(form) !== JSON.stringify(formFrom(item)));

  // Re-sync when another document is opened, or when the record changed and there are no local edits.
  useEffect(() => {
    if (!item) return;
    if (item.version !== baseVersion && !dirty) {
      setForm(formFrom(item));
      setBaseVersion(item.version);
      setConflict(null);
    } else if (item.version !== baseVersion && dirty) {
      setConflict("عُدّلت هذه الوثيقة من جهة أخرى أثناء عملك، ولن يُقبل حفظ نسختك. أعد التحميل لرؤية آخر نسخة ثم أعد تعديلاتك.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.version]);

  useEffect(() => {
    if (item) {
      setForm(formFrom(item));
      setBaseVersion(item.version);
      setConflict(null);
      setAck(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const editable = !!item && ["review", "needs_correction", "ready"].includes(item.state);
  const request = item ? openRequestFor(item.id) : undefined;

  const save = useCallback((): boolean => {
    if (!item || !form) return false;
    if (!dirty) return true;
    const fields: ExtractedField[] = FIELD_DEFS.filter((d) => form.values[d.key]?.trim() || item.fields.some((f) => f.key === d.key)).map((d) => {
      const old = item.fields.find((f) => f.key === d.key);
      return { ...(old ?? { confidence: 100, source: "human" as const }), key: d.key, label: d.label, value: form.values[d.key] ?? "" };
    });
    const r = saveReview(item.id, baseVersion, { fields, corrected: form.corrected, category: form.category });
    if (!r.ok) {
      if (r.code === "conflict") setConflict(r.error);
      toast.error(r.error);
      return false;
    }
    setBaseVersion(r.data.version);
    setForm(formFrom(r.data));
    toast.success("حُفظت المراجعة", { description: "التعديلات مسجّلة في سجل الوثيقة." });
    return true;
  }, [item, form, dirty, baseVersion]);

  const goTo = useCallback(
    (delta: 1 | -1) => {
      const target = queue[position + delta];
      if (!target) return;
      if (dirty && !save()) return;
      navigate(`/app/archive/batches/${batchId}/review/${target.id}`);
    },
    [queue, position, dirty, save, navigate, batchId],
  );

  const approve = useCallback(() => {
    if (!item) return;
    if (item.state === "needs_correction") {
      if (dirty && !save()) return;
      const r = resubmitItem(item.id, findItem(item.id)!.version);
      if (r.ok) toast.success("أُعيد تقديم الوثيقة للمراجعة");
      else toast.error(r.error);
      return;
    }
    if (dirty && !save()) return;
    const r = submitVerification(item.id, { uncertaintyReviewed: ack });
    if (!r.ok) return toast.error(r.error);
    toast.success("قُدّمت البيانات للاعتماد", { description: "لن تصبح الوثيقة جاهزة للأرشفة قبل الموافقة." });
  }, [item, dirty, save, ack]);

  // Keyboard workflow for high-volume review.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(-1);
      } else if (k === "s" || e.code === "KeyS") {
        e.preventDefault();
        save();
      } else if (k === "a" || e.code === "KeyA") {
        e.preventDefault();
        approve();
      } else if (k === "r" || e.code === "KeyR") {
        e.preventDefault();
        setReturnOpen(true);
      } else if (/^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        setParam("tab", TABS[Number(e.code.slice(5)) - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!item || !batch || !form) {
    return (
      <AppShell title="المراجعة والتحقق" backTo={`/app/archive/batches/${batchId}?step=review`} actionBar>
        <EmptyState icon={FileQuestion} title="الوثيقة غير متاحة" action={<Button onClick={() => navigate(`/app/archive/batches/${batchId}?step=review`)}>العودة إلى الدفعة</Button>} />
      </AppShell>
    );
  }

  const page = pages[pageIdx];
  const uncertain = uncertainFields(item.id);
  const viewer = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="تصغير" onClick={() => setZoom((z) => Math.max(50, z - 25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center font-mono text-xs">{zoom}%</span>
          <Button size="icon" variant="ghost" aria-label="تكبير" onClick={() => setZoom((z) => Math.min(300, z + 25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          {!desktop && (
            <Button size="icon" variant="ghost" aria-label="عرض بملء الشاشة" onClick={() => setFullView(true)}>
              <Expand className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          الصفحة {pageIdx + 1} من {pages.length}
          {page?.quality.blurry && <span className="text-alert"> • قد تكون ضبابية</span>}
          {page?.quality.blank && <span className="text-alert"> • تبدو فارغة</span>}
        </p>
      </div>
      <PagePreview page={page} zoom={zoom} className={desktop ? "h-[calc(100dvh-16rem)]" : "h-[45dvh]"} />
      {pages.length > 1 && (
        <ol className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="صفحات الوثيقة">
          {pages.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setParam("page", String(i + 1))}
                aria-current={i === pageIdx ? "page" : undefined}
                aria-label={`الصفحة ${i + 1}`}
                className={cn("block w-14 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", i === pageIdx && "ring-2 ring-gold")}
              >
                <PageThumb thumbKey={p.thumbKey} rotation={p.rotation} label={`الصفحة ${i + 1}`} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <AppShell title="المراجعة والتحقق" subtitle={`${item.fileName} — ${position + 1} من ${queue.length}`} backTo={`/app/archive/batches/${batchId}?step=review`} actionBar>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ItemStateBadge state={item.state} />
            {dirty && <span className="text-xs text-gold-deep">تعديلات غير محفوظة</span>}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setHelp(true)} className="hidden lg:inline-flex">
            <Keyboard className="h-4 w-4" />
            اختصارات لوحة المفاتيح
          </Button>
        </div>

        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
            <span>{conflict}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setForm(formFrom(item));
                setBaseVersion(item.version);
                setConflict(null);
              }}
            >
              إعادة التحميل
            </Button>
          </div>
        )}
        {item.state === "needs_correction" && item.review?.returnReason && (
          <p className="rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">أُرجعت للتصحيح: {item.review.returnReason}</p>
        )}
        {item.state === "pending_approval" && request && <ApprovalRequestCard request={request} compact />}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="lg:sticky lg:top-24 lg:self-start">{viewer}</div>

          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => setParam("tab", v)}>
              <TabsList>
                {TABS.map((t, i) => (
                  <TabsTrigger key={t} value={t}>
                    {TAB_LABELS[t]}
                    {t === "duplicates" && item.duplicates.some((d) => !d.decision) && <span className="h-2 w-2 rounded-full bg-alert" aria-label="تكرار لم يُحسم" />}
                    <span className="sr-only"> (Alt+{i + 1})</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="data" className="space-y-4">
                <div className="space-y-1.5">
                  <Label>التصنيف</Label>
                  <Select value={form.category} disabled={!editable} onValueChange={(v) => setForm({ ...form, category: v as ArchiveCategory })}>
                    <SelectTrigger aria-label="التصنيف">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CATEGORY_LABELS) as ArchiveCategory[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {CATEGORY_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {item.classification && (
                    <p className="text-[11px] text-muted-foreground">
                      اقتراح النظام: {CATEGORY_LABELS[item.classification.suggested]} ({item.classification.confidence}%) — {item.classification.evidence.slice(1).join("، ")}
                    </p>
                  )}
                </div>
                {FIELD_DEFS.map((d) => {
                  const f = item.fields.find((x) => x.key === d.key);
                  const low = f && f.source !== "human" && f.confidence < LOW_CONFIDENCE;
                  return (
                    <div key={d.key} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor={`f-${d.key}`}>{d.label}</Label>
                        {f ? <ConfidenceBadge value={f.confidence} source={f.source} /> : <span className="text-[11px] text-muted-foreground">لم يُستخرج</span>}
                      </div>
                      <Input
                        id={`f-${d.key}`}
                        type={d.type}
                        value={form.values[d.key] ?? ""}
                        disabled={!editable}
                        onChange={(e) => setForm({ ...form, values: { ...form.values, [d.key]: e.target.value } })}
                        className={cn(low && "border-alert/60 bg-alert/5")}
                        aria-invalid={!!low}
                        aria-describedby={f?.evidence ? `ev-${d.key}` : undefined}
                      />
                      {f && (
                        <p id={`ev-${d.key}`} className="text-[11px] text-muted-foreground">
                          {SOURCE_LABELS[f.source]}
                          {f.page ? ` — الصفحة ${f.page}` : ""}
                          {f.evidence ? ` — «${f.evidence.slice(0, 80)}»` : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
                {item.missingPages && item.missingPages.length > 0 && (
                  <p className="flex items-start gap-2 text-xs text-alert">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    الترقيم يشير إلى صفحات ناقصة: {item.missingPages.join("، ")}. أضفها من «رفع الوثائق ← الصفحات» أو أرجع الوثيقة للتصحيح.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="text" className="space-y-4">
                <p className="text-xs text-muted-foreground">النص الأصلي المستخرج محفوظ كما هو ولا يُعدّل؛ تصحيحاتك تُحفظ في نسخة منفصلة. الكلمات المظللة قرأها المحرك بثقة منخفضة.</p>
                {pages.map((p, i) => (
                  <section key={p.id} className="space-y-2 rounded-[var(--radius)] border border-border p-3" aria-label={`نص الصفحة ${i + 1}`}>
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" className="text-sm font-medium underline-offset-2 hover:underline" onClick={() => setParam("page", String(i + 1))}>
                        الصفحة {i + 1}
                      </button>
                      {p.ocr && <ConfidenceBadge value={p.ocr.confidence} />}
                    </div>
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">النص الأصلي (OCR)</p>
                        <div className="max-h-64 overflow-auto whitespace-pre-line rounded-sm bg-muted/40 p-2 font-legal text-sm leading-7" dir="auto">
                          {p.ocr ? highlightText(p.ocr.text, p.ocr.uncertain.filter((w) => w.length > 2).slice(0, 40)) : <span className="text-muted-foreground">لا يوجد نص مستخرج.</span>}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`c-${p.id}`} className="mb-1 block text-[11px] text-muted-foreground">
                          النص المصحّح
                        </Label>
                        <Textarea
                          id={`c-${p.id}`}
                          rows={8}
                          dir="auto"
                          disabled={!editable}
                          value={form.corrected[p.id] ?? ""}
                          onChange={(e) => setForm({ ...form, corrected: { ...form.corrected, [p.id]: e.target.value } })}
                          className="font-legal leading-7"
                        />
                      </div>
                    </div>
                  </section>
                ))}
              </TabsContent>

              <TabsContent value="duplicates">
                <DuplicatesPanel item={item} readOnly={!editable} />
              </TabsContent>
              <TabsContent value="case">
                <CaseMatchPanel item={item} readOnly={!editable || item.state === "ready"} />
              </TabsContent>
              <TabsContent value="assistant">
                <AssistantShortcuts item={item} batch={batch} items={queue} />
              </TabsContent>
            </Tabs>

            {item.state === "review" && uncertain.length > 0 && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-3 text-sm">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-1" />
                <span>
                  راجعتُ الحقول ذات الثقة المنخفضة وقارنتها بصورة الوثيقة ({uncertain.map((f) => f.label).join("، ")}).
                </span>
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Persistent review action bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:sticky lg:bottom-0 lg:mt-6 lg:rounded-[var(--radius)] lg:border lg:px-4">
        {/* Phones: navigation + secondary actions on one row, the primary action full width below. */}
        <div className="mx-auto max-w-5xl space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
          <div className="flex items-center gap-2 sm:contents">
            <Button size="icon" variant="ghost" aria-label="الوثيقة السابقة (Alt+→)" disabled={position <= 0} onClick={() => goTo(-1)} className="shrink-0">
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button variant="outline" onClick={() => save()} disabled={!editable || !dirty} className="min-w-0 flex-1">
              <Save className="h-4 w-4" />
              حفظ
            </Button>
            {item.state === "pending_approval" ? (
              <Button
                variant="outline"
                className="min-w-0 flex-1"
                onClick={() => {
                  const r = withdrawVerification(item.id);
                  if (r.ok) toast.success("سُحب الطلب وأُعيدت الوثيقة للمراجعة");
                  else toast.error(r.error);
                }}
              >
                <Undo2 className="h-4 w-4" />
                سحب الطلب
              </Button>
            ) : (
              <Button variant="outline" className="min-w-0 flex-1 text-alert" disabled={item.state !== "review"} onClick={() => setReturnOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                إرجاع للتصحيح
              </Button>
            )}
            <Button size="icon" variant="ghost" aria-label="الوثيقة التالية (Alt+←)" disabled={position >= queue.length - 1} onClick={() => goTo(1)} className="shrink-0 sm:order-last">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
          <Button
            onClick={approve}
            className="w-full sm:w-auto sm:flex-1"
            disabled={!(item.state === "review" || item.state === "needs_correction") || (item.state === "review" && uncertain.length > 0 && !ack)}
          >
            {item.state === "needs_correction" ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {item.state === "needs_correction" ? "إعادة التقديم" : "اعتماد البيانات"}
          </Button>
        </div>
      </div>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرجاع للتصحيح</DialogTitle>
            <DialogDescription>وضّح ما يجب تصحيحه (إعادة تصوير صفحة، تاريخ غير مقروء، صفحة ناقصة...).</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="سبب الإرجاع" autoFocus />
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                const r = returnForCorrection(item.id, findItem(item.id)!.version, reason);
                if (!r.ok) return toast.error(r.error);
                setReturnOpen(false);
                setReason("");
                toast.success("أُرجعت الوثيقة للتصحيح");
              }}
            >
              تأكيد الإرجاع
            </Button>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fullView} onOpenChange={setFullView}>
        <DialogContent className="h-[100dvh] max-h-none rounded-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>
              {item.fileName} — الصفحة {pageIdx + 1}
            </DialogTitle>
          </DialogHeader>
          <PagePreview page={page} zoom={zoom} className="h-[calc(100dvh-8rem)]" />
        </DialogContent>
      </Dialog>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>اختصارات لوحة المفاتيح</DialogTitle>
            <DialogDescription>لمعالجة عدد كبير من الوثائق بسرعة.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {[
              ["Alt + S", "حفظ المراجعة"],
              ["Alt + A", "اعتماد البيانات / إعادة التقديم"],
              ["Alt + R", "إرجاع للتصحيح"],
              ["Alt + ←", "الوثيقة التالية (مع حفظ تلقائي)"],
              ["Alt + →", "الوثيقة السابقة"],
              ["Alt + 1…5", "التنقل بين التبويبات"],
              ["?", "عرض هذه القائمة"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
                    {k}
                  </kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      {item.state === "ocr" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          يُعاد استخراج النص بعد تعديل الصفحات...
        </p>
      )}
      <Link to={`/app/archive/batches/${batchId}?step=review`} className="sr-only">
        العودة إلى قائمة المراجعة
      </Link>
    </AppShell>
  );
}
