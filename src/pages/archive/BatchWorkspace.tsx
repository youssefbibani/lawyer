import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  FileStack,
  Images,
  Layers,
  Loader2,
  Paperclip,
  RotateCcw,
  ScanText,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArchiveStepper, ConfidenceBadge, ItemStateBadge, PageThumb, itemThumbKey, type StepDef } from "@/components/archive/ArchiveBits";
import { AssistantShortcuts, CaseMatchPanel, DuplicatesPanel } from "@/components/archive/ArchivePanels";
import { PageEditor } from "@/components/archive/PageEditor";
import { ApprovalRequestCard } from "@/components/approvals/ApprovalRequestCard";
import { useDB } from "@/hooks/use-db";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getMember } from "@/services/api";
import { batchItems, saveReview } from "@/services/archive/service";
import { importFiles, reattachFile, retryItem, runJobs, useItemProgress } from "@/services/archive/pipeline";
import { requestFinalization } from "@/services/archive/actions";
import { CATEGORY_LABELS } from "@/services/archive/workflow";
import { getBlobStore } from "@/services/archive/blobStore";
import { getOcrProvider } from "@/services/archive/ocr";
import type { ArchiveBatch, ArchiveCategory, ArchiveItem } from "@/types";

const STEP_KEYS = ["batch", "upload", "extract", "classify", "review", "match", "finalize"] as const;
type StepKey = (typeof STEP_KEYS)[number];
const STEP_LABELS: Record<StepKey, string> = {
  batch: "الدفعة",
  upload: "رفع الوثائق",
  extract: "استخراج البيانات",
  classify: "التصنيف الذكي",
  review: "المراجعة والتحقق",
  match: "ربط بالقضية",
  finalize: "الحفظ النهائي",
};

function defaultStep(items: ArchiveItem[]): StepKey {
  if (!items.length) return "upload";
  if (items.some((i) => ["draft", "uploading", "ocr", "failed"].includes(i.state))) return "extract";
  if (items.some((i) => ["review", "needs_correction", "pending_approval"].includes(i.state))) return "review";
  if (items.some((i) => i.state === "ready")) return "finalize";
  return "finalize";
}

function ItemRow({ item, children, progress }: { item: ArchiveItem; children?: ReactNode; progress?: { stage: string; fraction: number } }) {
  const pages = item.pages.length;
  const quality = item.pages.filter((p) => p.quality.blank || p.quality.blurry);
  return (
    <li className="card-elevated flex gap-3 p-3">
      <PageThumb thumbKey={itemThumbKey(item)} label={item.fileName} className="w-14 shrink-0 self-start sm:w-16" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium" title={item.fileName}>
            {item.fileName}
          </p>
          <ItemStateBadge state={item.state} />
        </div>
        <p className="text-xs text-muted-foreground">
          {(item.size / (1024 * 1024)).toFixed(2)} م.ب{pages ? ` • ${pages} ${pages === 1 ? "صفحة" : "صفحات"}` : ""}
          {item.excluded && <span className="text-alert"> • مستبعدة</span>}
        </p>
        {progress && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-[11px] text-muted-foreground">{progress.stage}</p>
            <Progress value={Math.round(progress.fraction * 100)} aria-label={`تقدم ${item.fileName}`} />
          </div>
        )}
        {quality.length > 0 && (
          <p className="text-[11px] text-alert">
            {quality.map((p) => `الصفحة ${p.index + 1}: ${p.quality.blank ? "فارغة" : "ضبابية"}`).join(" • ")}
          </p>
        )}
        {item.missingPages && item.missingPages.length > 0 && <p className="text-[11px] text-alert">صفحات قد تكون ناقصة حسب الترقيم: {item.missingPages.join("، ")}</p>}
        {item.error && <p className="text-xs text-alert">{item.error}</p>}
        {children}
      </div>
    </li>
  );
}

// ——— Step 2: upload ———

function StepUpload({ batch, items }: { batch: ArchiveBatch; items: ArchiveItem[] }) {
  const progress = useItemProgress();
  const touch = useMediaQuery("(pointer: coarse)");
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const reattachInput = useRef<HTMLInputElement>(null);
  const reattachTarget = useRef<string | null>(null);
  const [captured, setCaptured] = useState<{ file: File; url: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ArchiveItem | null>(null);
  const store = getBlobStore();

  useEffect(() => () => captured.forEach((c) => URL.revokeObjectURL(c.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(files: File[], single = false) {
    if (!files.length) return;
    setBusy(true);
    const r = await importFiles(batch.id, files, { asSingleDocument: single });
    setBusy(false);
    if (r.items.length) toast.success(`أُضيفت ${r.items.length} وثائق إلى قائمة المعالجة`, { description: "الأصول محفوظة ولن تُحذف." });
    for (const msg of r.rejected) toast.error(msg);
  }

  async function finishCapture() {
    const files = captured.map((c) => c.file);
    captured.forEach((c) => URL.revokeObjectURL(c.url));
    setCaptured([]);
    await upload(files, true);
  }

  async function retry(item: ArchiveItem) {
    const r = await retryItem(item.id);
    if (!r.ok) {
      toast.error(r.error);
      if (r.error.includes("أعد اختيار")) {
        reattachTarget.current = item.id;
        reattachInput.current?.click();
      }
    }
  }

  const expected = batch.expectedCount;
  return (
    <div className="space-y-4">
      {!store.persistent && (
        <p className="rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-xs text-alert">هذا المتصفح لا يوفّر تخزيناً دائماً: ستُفقد الأصول عند إغلاق الصفحة.</p>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-[var(--radius)] border-2 border-dashed p-6 text-center transition-colors sm:p-10",
          drag ? "border-gold bg-gold/5" : "border-border",
        )}
      >
        <Upload className="h-9 w-9 text-gold-deep" aria-hidden="true" />
        <p className="font-medium">{touch ? "صوّر الوثائق أو اختر ملفات" : "اسحب ملفات PDF أو صوراً هنا (عدة ملفات دفعة واحدة)"}</p>
        <p className="text-xs text-muted-foreground" dir="ltr">
          PDF • JPG • PNG • WEBP — 50 م.ب كحد أقصى للملف
        </p>
        <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
          <Button onClick={() => cameraInput.current?.click()} variant={touch ? "gold" : "outline"}>
            <Camera className="h-4 w-4" />
            تصوير صفحات
          </Button>
          <Button onClick={() => fileInput.current?.click()} variant={touch ? "outline" : "gold"} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
            اختيار ملفات
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(files);
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            setCaptured((c) => [...c, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
          }}
        />
        <input
          ref={reattachInput}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !reattachTarget.current) return;
            const r = await reattachFile(reattachTarget.current, f);
            if (r.ok) toast.success("أُعيد إرفاق الملف الأصلي واستؤنفت المعالجة");
            else toast.error(r.error);
          }}
        />
      </div>

      {captured.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Images className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              وثيقة قيد التصوير — {captured.length} صفحات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {captured.map((c, i) => (
                <li key={c.url} className="relative overflow-hidden rounded-sm border border-border">
                  <img src={c.url} alt={`الصفحة ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`حذف الصفحة ${i + 1} من التصوير`}
                    onClick={() => {
                      URL.revokeObjectURL(c.url);
                      setCaptured((all) => all.filter((x) => x.url !== c.url));
                    }}
                    className="absolute left-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-cream coarse:h-11 coarse:w-11"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => cameraInput.current?.click()}>
                <Camera className="h-4 w-4" />
                صفحة إضافية
              </Button>
              <Button onClick={() => void finishCapture()}>
                <CheckCircle2 className="h-4 w-4" />
                إنهاء الوثيقة ({captured.length} صفحات)
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  captured.forEach((c) => URL.revokeObjectURL(c.url));
                  setCaptured([]);
                }}
              >
                إلغاء التصوير
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {items.length} وثائق في الدفعة{expected ? ` من أصل ${expected} متوقعة` : ""}
        </p>
        {expected && items.length < expected && <StatusBadge label={`${expected - items.length} وثائق لم تُرفع بعد`} tone="gold" />}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Upload} title="لا توجد وثائق بعد" description="ابدأ برفع الملفات أو تصوير الصفحات." />
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} progress={progress.get(i.id)}>
              <div className="flex flex-wrap gap-2">
                {i.state === "failed" && (
                  <>
                    <Button size="sm" onClick={() => void retry(i)}>
                      <RotateCcw className="h-4 w-4" />
                      إعادة المحاولة
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        reattachTarget.current = i.id;
                        reattachInput.current?.click();
                      }}
                    >
                      <Paperclip className="h-4 w-4" />
                      إعادة إرفاق الملف
                    </Button>
                  </>
                )}
                {i.pages.length > 0 && ["review", "needs_correction", "failed"].includes(i.state) && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                    <Layers className="h-4 w-4" />
                    الصفحات
                  </Button>
                )}
              </div>
            </ItemRow>
          ))}
        </ul>
      )}
      {editing && <PageEditor item={items.find((x) => x.id === editing.id) ?? editing} open onOpenChange={(o) => !o && setEditing(null)} />}
    </div>
  );
}

// ——— Step 3: extraction ———

function StepExtract({ batch, items }: { batch: ArchiveBatch; items: ArchiveItem[] }) {
  const progress = useItemProgress();
  const ocr = getOcrProvider();
  const waiting = items.some((i) => i.state === "uploading" || i.state === "ocr");
  return (
    <div className="space-y-4">
      <p className={cn("flex items-start gap-2 rounded-[var(--radius)] border p-3 text-xs leading-6", ocr ? "border-border bg-muted/40 text-muted-foreground" : "border-alert/30 bg-alert/10 text-alert")}>
        <ScanText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {ocr ? `${ocr.label}. النص الأصلي المستخرج يُحفظ دون تعديل، والتصحيحات البشرية تُحفظ منفصلة.` : "لا يوجد محرك OCR مهيأ — لن يُستخرج أي نص ولن تُعرض نتائج مختلقة."}
      </p>
      {waiting && (
        <Button variant="outline" size="sm" onClick={() => void runJobs()}>
          <Loader2 className="h-4 w-4" />
          متابعة المعالجة المعلّقة
        </Button>
      )}
      <ul className="space-y-3">
        {items.map((i) => {
          const done = i.pages.filter((p) => p.ocr);
          const avg = done.length ? Math.round(done.reduce((s, p) => s + (p.ocr?.confidence ?? 0), 0) / done.length) : null;
          const langs = [...new Set(done.map((p) => p.ocr?.lang))].map((l) => ({ ar: "عربي", fr: "فرنسي", mixed: "عربي/فرنسي", unknown: "غير محدد" })[l ?? "unknown"]);
          return (
            <ItemRow key={i.id} item={i} progress={progress.get(i.id)}>
              {done.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  صفحات مستخرجة {done.length}/{i.pages.length} • اللغة: {langs.join("، ")} {avg !== null && <>• متوسط الثقة <ConfidenceBadge value={avg} /></>}
                </p>
              )}
              {i.fields.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {i.fields.filter((f) => f.key !== "title").map((f) => (
                    <li key={f.key} className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px]">
                      <span className="text-muted-foreground">{f.label}:</span>
                      <span className="max-w-[12rem] truncate">{f.value}</span>
                      <ConfidenceBadge value={f.confidence} source={f.source} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {done.length > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/app/archive/batches/${batch.id}/review/${i.id}?tab=text`}>مقارنة الصورة بالنص</Link>
                  </Button>
                )}
                {i.state === "failed" && (
                  <Button size="sm" onClick={async () => { const r = await retryItem(i.id); if (!r.ok) toast.error(r.error); }}>
                    <RotateCcw className="h-4 w-4" />
                    إعادة الاستخراج
                  </Button>
                )}
              </div>
            </ItemRow>
          );
        })}
      </ul>
      {items.length === 0 && <EmptyState icon={ScanText} title="لا توجد وثائق" description="ارفع الوثائق أولاً." />}
    </div>
  );
}

// ——— Step 4: classification ———

function StepClassify({ items }: { items: ArchiveItem[] }) {
  const ready = items.filter((i) => i.classification);
  return (
    <div className="space-y-3">
      {ready.length === 0 && <EmptyState icon={Layers} title="لا توجد وثائق مصنّفة بعد" description="يظهر التصنيف المقترح بعد استخراج النص." />}
      <ul className="space-y-3">
        {ready.map((i) => {
          const c = i.classification!;
          const editable = ["review", "needs_correction", "ready"].includes(i.state);
          return (
            <ItemRow key={i.id} item={i}>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    الاقتراح: <span className="font-medium text-foreground">{CATEGORY_LABELS[c.suggested]}</span> <ConfidenceBadge value={c.confidence} />
                  </p>
                  <ul className="text-[11px] text-muted-foreground">
                    {c.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <Select
                    value={c.final ?? c.suggested}
                    disabled={!editable}
                    onValueChange={(v) => {
                      const r = saveReview(i.id, i.version, { category: v as ArchiveCategory });
                      if (!r.ok) toast.error(r.error);
                    }}
                  >
                    <SelectTrigger aria-label={`تصنيف ${i.fileName}`}>
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
                  {c.overriddenBy && <p className="text-[11px] text-success">عُدّل التصنيف يدوياً من طرف {getMember(c.overriddenBy)?.shortName}</p>}
                </div>
                <DuplicatesPanel item={i} readOnly={i.state === "archived"} />
              </div>
            </ItemRow>
          );
        })}
      </ul>
    </div>
  );
}

// ——— Step 5: review queue ———

function StepReview({ batch, items }: { batch: ArchiveBatch; items: ArchiveItem[] }) {
  const navigate = useNavigate();
  const groups: { title: string; states: ArchiveItem["state"][] }[] = [
    { title: "في انتظار المراجعة", states: ["review"] },
    { title: "تحتاج إلى تصحيح", states: ["needs_correction"] },
    { title: "في انتظار الموافقة", states: ["pending_approval"] },
    { title: "جاهزة للأرشفة", states: ["ready"] },
  ];
  const first = items.find((i) => i.state === "review" || i.state === "needs_correction");
  return (
    <div className="space-y-5">
      {first && (
        <Button onClick={() => navigate(`/app/archive/batches/${batch.id}/review/${first.id}`)} className="w-full sm:w-auto">
          بدء المراجعة المتتالية
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      {groups.map((g) => {
        const list = items.filter((i) => g.states.includes(i.state));
        if (!list.length) return null;
        return (
          <section key={g.title} className="space-y-2">
            <h3 className="text-sm font-semibold">
              {g.title} ({list.length})
            </h3>
            <ul className="space-y-3">
              {list.map((i) => (
                <ItemRow key={i.id} item={i}>
                  {i.review?.returnReason && i.state === "needs_correction" && <p className="text-xs text-alert">سبب الإرجاع: {i.review.returnReason}</p>}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/app/archive/batches/${batch.id}/review/${i.id}`}>فتح للمراجعة</Link>
                  </Button>
                </ItemRow>
              ))}
            </ul>
          </section>
        );
      })}
      {!items.some((i) => groups.some((g) => g.states.includes(i.state))) && (
        <EmptyState icon={CheckCircle2} title="لا توجد وثائق للمراجعة" description="تظهر الوثائق هنا بعد استخراج بياناتها." />
      )}
    </div>
  );
}

// ——— Step 6: case matching ———

function StepMatch({ items }: { items: ArchiveItem[] }) {
  const list = items.filter((i) => ["review", "needs_correction", "ready", "pending_approval"].includes(i.state));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">يقترح النظام القضايا المحتملة مع الأدلة. القرار هنا مقترح فقط؛ الربط الفعلي يتم بعد الموافقة عند الحفظ النهائي.</p>
      {list.length === 0 && <EmptyState icon={Layers} title="لا توجد وثائق للربط" />}
      <ul className="space-y-3">
        {list.map((i) => (
          <ItemRow key={i.id} item={i}>
            <CaseMatchPanel item={i} readOnly={i.state === "pending_approval" || i.state === "ready"} />
          </ItemRow>
        ))}
      </ul>
    </div>
  );
}

// ——— Step 7: finalize ———

function StepFinalize({ batch, items }: { batch: ArchiveBatch; items: ArchiveItem[] }) {
  const db = useDB();
  const readyItems = items.filter((i) => i.state === "ready" && !i.excluded);
  const [selected, setSelected] = useState<string[]>([]);
  const requests = db.approvals.filter((a) => a.operation === "archive.finalize" && a.params.batchId === batch.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = requests.filter((r) => r.status === "pending" || r.status === "approved");
  const archived = items.filter((i) => i.state === "archived");
  const blocked = items.filter((i) => !["ready", "archived"].includes(i.state) && !i.excluded);

  function request() {
    const r = requestFinalization(batch.id, selected);
    if (!r.ok) return toast.error(r.error);
    setSelected([]);
    toast.success("أُنشئ طلب الحفظ النهائي", { description: "لن يُحفظ شيء قبل الموافقة الصريحة." });
  }

  return (
    <div className="space-y-5">
      {blocked.length > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-3 text-xs text-gold-deep">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {blocked.length} وثائق لم تُعتمد بعد ولن تدخل الأرشيف الموثّق إلا بعد المراجعة والموافقة.
        </p>
      )}
      {open.map((r) => (
        <ApprovalRequestCard key={r.id} request={r} />
      ))}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">جاهزة للحفظ النهائي ({readyItems.length})</h3>
          {readyItems.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === readyItems.length ? [] : readyItems.map((i) => i.id))}>
              {selected.length === readyItems.length ? "إلغاء التحديد" : "تحديد الكل"}
            </Button>
          )}
        </div>
        {readyItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد وثائق معتمدة جاهزة للحفظ.</p>
        ) : (
          <ul className="space-y-2">
            {readyItems.map((i) => (
              <li key={i.id}>
                <label className="card-elevated flex min-h-12 cursor-pointer items-center gap-3 p-3">
                  <Checkbox
                    checked={selected.includes(i.id)}
                    onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, i.id] : s.filter((x) => x !== i.id)))}
                    aria-label={`تحديد ${i.fileName}`}
                    disabled={open.some((r) => (r.params.items as { itemId: string }[]).some((x) => x.itemId === i.id))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[i.classification?.final ?? i.classification?.suggested ?? "other"]}
                      {i.caseMatch.decision === "approved" && i.caseMatch.caseId ? ` — ${db.cases.find((c) => c.id === i.caseMatch.caseId)?.client}` : " — بدون ربط"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {readyItems.length > 0 && (
          <Button onClick={request} disabled={!selected.length} className="w-full sm:w-auto">
            طلب الحفظ النهائي ({selected.length})
          </Button>
        )}
      </section>
      {archived.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">مؤرشفة ({archived.length})</h3>
          <ul className="space-y-2">
            {archived.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-success/30 bg-success/5 p-3 text-sm">
                <span className="min-w-0 truncate">{i.fileName}</span>
                {i.archivedDocumentId && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/app/document/${i.archivedDocumentId}`}>عرض في الأرشيف</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {requests.filter((r) => !open.includes(r)).slice(0, 5).map((r) => (
        <ApprovalRequestCard key={r.id} request={r} compact />
      ))}
    </div>
  );
}

// ——— Step 1 (overview) ———

function StepBatch({ batch, items }: { batch: ArchiveBatch; items: ArchiveItem[] }) {
  const db = useDB();
  const c = db.cases.find((x) => x.id === batch.defaultCaseId);
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">المرجع: </span>
            <span className="ref-tag">{batch.reference}</span>
          </p>
          <p>
            <span className="text-muted-foreground">مكان الحفظ: </span>
            {batch.location}
          </p>
          <p>
            <span className="text-muted-foreground">المسؤول: </span>
            {getMember(batch.responsibleId)?.name}
          </p>
          <p>
            <span className="text-muted-foreground">العدد المتوقع: </span>
            {batch.expectedCount ?? "—"}
          </p>
          {c && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">القضية الافتراضية للاقتراح: </span>
              {c.client} — {c.ref}
            </p>
          )}
          {batch.notes && <p className="text-muted-foreground sm:col-span-2">{batch.notes}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">المساعد</CardTitle>
        </CardHeader>
        <CardContent>
          <AssistantShortcuts batch={batch} items={items} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function BatchWorkspace() {
  const { batchId = "" } = useParams<{ batchId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const db = useDB();
  const batch = db.batches.find((b) => b.id === batchId && b.tenantId === db.tenantId);
  const items = useMemo(() => batchItems(batchId, db).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [batchId, db]);
  const step = (STEP_KEYS.includes(params.get("step") as StepKey) ? params.get("step") : defaultStep(items)) as StepKey;

  if (!batch) {
    return (
      <AppShell title="دفعة الأرشفة" backTo="/app/archive" actionBar>
        <EmptyState icon={FileStack} title="الدفعة غير موجودة" action={<Button onClick={() => navigate("/app/archive")}>العودة</Button>} />
      </AppShell>
    );
  }

  const count = (states: ArchiveItem["state"][]) => items.filter((i) => states.includes(i.state)).length;
  const steps: StepDef[] = [
    { key: "batch", label: STEP_LABELS.batch, done: true },
    { key: "upload", label: STEP_LABELS.upload, count: items.length, done: items.length > 0 && !count(["draft", "uploading"]) },
    { key: "extract", label: STEP_LABELS.extract, count: count(["ocr", "failed"]), done: items.length > 0 && !count(["draft", "uploading", "ocr", "failed"]) },
    { key: "classify", label: STEP_LABELS.classify, count: items.filter((i) => i.duplicates.some((d) => !d.decision)).length, done: items.length > 0 && items.every((i) => i.classification || i.state === "failed") },
    { key: "review", label: STEP_LABELS.review, count: count(["review", "needs_correction", "pending_approval"]), done: items.length > 0 && !count(["review", "needs_correction", "pending_approval", "ocr", "uploading", "failed"]) },
    { key: "match", label: STEP_LABELS.match, count: items.filter((i) => i.caseMatch.decision === "pending" && i.state === "review").length },
    { key: "finalize", label: STEP_LABELS.finalize, count: count(["ready"]), done: items.length > 0 && items.every((i) => i.state === "archived" || i.excluded) },
  ];
  const index = STEP_KEYS.indexOf(step);
  const go = (key: string) => setParams({ step: key }, { replace: true });

  return (
    <AppShell title={batch.name} subtitle={`${batch.reference} — ${STEP_LABELS[step]}`} backTo="/app/archive" actionBar>
      <div className="space-y-5">
        <ArchiveStepper steps={steps} current={step} onSelect={go} />
        <section aria-label={STEP_LABELS[step]}>
          <h2 className="mb-3 font-heading text-xl">{STEP_LABELS[step]}</h2>
          {step === "batch" && <StepBatch batch={batch} items={items} />}
          {step === "upload" && <StepUpload batch={batch} items={items} />}
          {step === "extract" && <StepExtract batch={batch} items={items} />}
          {step === "classify" && <StepClassify items={items} />}
          {step === "review" && <StepReview batch={batch} items={items} />}
          {step === "match" && <StepMatch items={items} />}
          {step === "finalize" && <StepFinalize batch={batch} items={items} />}
        </section>
      </div>
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 lg:mx-0 lg:flex">
          <Button variant="outline" disabled={index === 0} onClick={() => go(STEP_KEYS[index - 1])}>
            المرحلة السابقة
          </Button>
          <Button disabled={index === STEP_KEYS.length - 1} onClick={() => go(STEP_KEYS[index + 1])}>
            المرحلة التالية
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
