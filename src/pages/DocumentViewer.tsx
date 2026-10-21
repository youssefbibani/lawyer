import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileQuestion,
  Info,
  Link2,
  Maximize2,
  Printer,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CaseReference } from "@/components/shared/CaseReference";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { countMatches, highlightText } from "@/components/documents/highlight";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleCases, findAccessibleDocument, findAccessibleCase, isDocumentLinked, linkDocumentToCase } from "@/services/api";
import { can } from "@/services/permissions";
import { detectInjection } from "@/services/retrieval";
import { formatArabicDate } from "@/lib/formatters";
import { printElement } from "@/lib/print";
import { cn } from "@/lib/utils";

const ZOOM_STEPS = [60, 75, 90, 100, 115, 130, 150, 175, 200];

export default function DocumentViewer() {
  const { docId = "a1" } = useParams<{ docId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const db = useDB();
  const user = useCurrentUser();
  const doc = findAccessibleDocument(docId, db, user);

  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(() => Number(params.get("page")) || 1);
  const [pageInput, setPageInput] = useState(String(page));
  const [searchOpen, setSearchOpen] = useState(!!params.get("q"));
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [activeMatch, setActiveMatch] = useState(0);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [confirmLink, setConfirmLink] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const totalPages = doc?.pages.length ?? 0;
  const matchesPerPage = useMemo(() => (doc ? doc.pages.map((p) => (query.trim().length >= 2 ? countMatches(p.text, query) : 0)) : []), [doc, query]);
  const totalMatches = matchesPerPage.reduce((a, b) => a + b, 0);
  const suspicious = doc?.pages.some((p) => detectInjection(p.text)) ?? false;
  const linkableCases = useMemo(() => accessibleCases(db, user).filter((c) => c.status === "نشطة" && c.id !== doc?.caseId), [db, user, doc]);
  const ownerCase = findAccessibleCase(doc?.caseId, db, user);

  function scrollToPage(n: number, smooth = true) {
    const el = document.getElementById(`doc-page-${n}`);
    el?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }

  // Deep link (?page=) on first render.
  useEffect(() => {
    const target = Number(params.get("page"));
    if (target > 1) setTimeout(() => scrollToPage(target, false), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Track the page currently in view.
  useEffect(() => {
    if (!doc || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const n = Number((visible.target as HTMLElement).dataset.page);
          setPage(n);
          setPageInput(String(n));
        }
      },
      { threshold: [0.3, 0.6] },
    );
    doc.pages.forEach((p) => {
      const el = document.getElementById(`doc-page-${p.number}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [doc, zoom]);

  // Jump to the active search match.
  useEffect(() => {
    if (!totalMatches) return;
    const el = document.getElementById(`match-${activeMatch}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatch, totalMatches, query]);

  useEffect(() => setActiveMatch(0), [query]);

  if (!doc) {
    return (
      <AppShell title="عرض الوثيقة" backTo="/app/search">
        <EmptyState
          icon={FileQuestion}
          title="الوثيقة غير متاحة"
          description="الوثيقة غير موجودة أو أنك غير مصرّح لك بالاطلاع عليها."
          action={<Button onClick={() => navigate("/app/search")}>العودة إلى البحث</Button>}
        />
      </AppShell>
    );
  }

  const go = (n: number) => {
    const clamped = Math.min(totalPages, Math.max(1, n));
    setPage(clamped);
    setPageInput(String(clamped));
    scrollToPage(clamped);
  };
  const zoomBy = (dir: 1 | -1) => {
    const idx = ZOOM_STEPS.findIndex((z) => z >= zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (idx === -1 ? ZOOM_STEPS.length - 1 : idx) + dir))];
    setZoom(next);
  };
  const stepMatch = (dir: 1 | -1) => totalMatches && setActiveMatch((m) => (m + dir + totalMatches) % totalMatches);

  function handleDownload() {
    const text = doc!.pages.map((p) => `— الصفحة ${p.number} —\n${p.text}`).join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc!.docType}_${doc!.caseRef.replace(/\//g, "-")}_نص_مستخرج.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("تم تحميل النص المستخرج");
  }

  function doLink() {
    setConfirmLink(false);
    const result = linkDocumentToCase(doc!.id, linkTarget);
    if (!result.ok) return toast.error(result.error);
    const c = accessibleCases(db, user).find((x) => x.id === linkTarget);
    toast.success(`تم ربط الوثيقة بقضية ${c?.client ?? ""}`, { description: "تمت إضافة الحدث إلى السجل الزمني للقضية." });
  }

  // Running match offset per page so `match-N` ids are global.
  let matchOffset = 0;
  const paperWidth = `min(100%, ${42 * (zoom / 100)}rem)`;
  const fontScale = zoom / 100;

  return (
    <AppShell title="عرض الوثيقة" subtitle={`${doc.title} — ${doc.caseRef}`} backTo={ownerCase ? `/app/cases/${ownerCase.id}` : "/app/search"}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          {/* Toolbar */}
          <div className="card-elevated sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 space-y-2 p-2 md:top-[calc(4rem+env(safe-area-inset-top))]">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <div className="flex items-center gap-1" role="group" aria-label="التنقل بين الصفحات">
                <Button variant="ghost" size="icon" aria-label="الصفحة السابقة" onClick={() => go(page - 1)} disabled={page <= 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  go(Number(pageInput) || 1);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span className="sr-only sm:not-sr-only">الصفحة</span>
                <Input
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  aria-label="رقم الصفحة"
                  className="h-9 w-12 px-1 text-center font-mono coarse:h-11"
                />
                <span>من {totalPages}</span>
              </form>
              <Button variant="ghost" size="icon" aria-label="الصفحة التالية" onClick={() => go(page + 1)} disabled={page >= totalPages}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="أدوات الوثيقة">
                <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label="البحث في الوثيقة" aria-expanded={searchOpen} onClick={() => setSearchOpen((s) => !s)}>
                  <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="تدوير" onClick={() => setRotation((r) => (r + 90) % 360)} className="hidden sm:inline-flex">
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="طباعة" onClick={() => printRef.current && printElement(printRef.current, doc.title)}>
                  <Printer className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="تحميل النص المستخرج" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="التكبير">
                <Button variant="ghost" size="icon" aria-label="تصغير" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOM_STEPS[0]}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center font-mono text-sm" aria-live="polite" aria-label={`التكبير ${zoom}%`}>
                {zoom}%
              </span>
              <Button variant="ghost" size="icon" aria-label="تكبير" onClick={() => zoomBy(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="ملاءمة العرض" onClick={() => setZoom(100)}>
                <Maximize2 className="h-4 w-4" />
              </Button>
              </div>
            </div>

            {searchOpen && (
              <div className="flex items-center gap-1" role="search">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus={!params.get("q")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        stepMatch(e.shiftKey ? -1 : 1);
                      }
                    }}
                    placeholder="ابحث داخل الوثيقة..."
                    aria-label="البحث داخل الوثيقة"
                    enterKeyHint="search"
                    className="pr-9"
                  />
                </div>
                <span className="w-14 shrink-0 text-center font-mono text-xs text-muted-foreground" aria-live="polite">
                  {query.trim().length >= 2 ? (totalMatches ? `${activeMatch + 1}/${totalMatches}` : "0") : ""}
                </span>
                <Button variant="ghost" size="icon" aria-label="النتيجة السابقة" onClick={() => stepMatch(-1)} disabled={!totalMatches}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="النتيجة التالية" onClick={() => stepMatch(1)} disabled={!totalMatches}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="إغلاق البحث"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {suspicious && (
            <p role="note" className="flex items-start gap-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              تحتوي هذه الوثيقة على عبارات تشبه تعليمات موجّهة لأنظمة آلية. يتعامل معها المساعد كنص غير موثوق ولا ينفّذها.
            </p>
          )}

          {/* Pages */}
          <div ref={scrollerRef} className="card-elevated overflow-x-auto bg-muted/40 p-3 sm:p-6">
            <div ref={printRef} className="space-y-4 sm:space-y-6">
              {doc.pages.map((p) => {
                const local = query.trim().length >= 2 ? activeMatch - matchOffset : -1;
                const prefix = `match`;
                const start = matchOffset;
                matchOffset += matchesPerPage[p.number - 1] ?? 0;
                return (
                  <section
                    key={p.number}
                    id={`doc-page-${p.number}`}
                    data-page={p.number}
                    aria-label={`الصفحة ${p.number}`}
                    className="print-break-avoid mx-auto scroll-mt-40 bg-white shadow-lg transition-[width] duration-200"
                    style={{ width: paperWidth, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
                  >
                    <div className="p-5 sm:p-10" style={{ fontSize: `${0.875 * fontScale}rem` }} dir={p.lang === "fr" ? "ltr" : "rtl"} lang={p.lang}>
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={`صورة الصفحة ${p.number}`} className="w-full" />
                      ) : p.text ? (
                        <div className="space-y-4 whitespace-pre-line font-legal leading-8 text-ink/90">
                          <PageText text={p.text} query={query} activeLocal={local} start={start} prefix={prefix} />
                        </div>
                      ) : (
                        <p className="py-16 text-center text-sm text-ink/50">لا يوجد نص مستخرج لهذه الصفحة.</p>
                      )}
                    </div>
                    <p className="border-t border-ink/10 py-2 text-center font-mono text-[11px] text-ink/50">
                      {p.number} / {totalPages}
                    </p>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>معلومات الوثيقة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                ["نوع الوثيقة", doc.docType],
                ["الحريف", doc.client],
                ["التاريخ", formatArabicDate(doc.date)],
                ["عدد الصفحات", String(totalPages)],
                ["الحجم", doc.size],
                ["اللغة", doc.language === "fr" ? "الفرنسية" : doc.language === "mixed" ? "العربية والفرنسية" : "العربية"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="min-w-0 text-left font-medium">{value}</span>
                  </div>
                  <Separator className="mt-3" />
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">المرجع</span>
                {ownerCase ? (
                  <Link to={`/app/cases/${ownerCase.id}`}>
                    <CaseReference value={doc.caseRef} />
                  </Link>
                ) : (
                  <CaseReference value={doc.caseRef} />
                )}
              </div>
              {doc.externalOrigin && (
                <p className="flex items-start gap-2 rounded-sm bg-alert/10 p-2 text-xs text-alert">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  وثيقة واردة من خارج المكتب: تُعامل كمحتوى غير موثوق.
                </p>
              )}
            </CardContent>
          </Card>

          {doc.keywords && doc.keywords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>كلمات مفتاحية</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {doc.keywords.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setSearchOpen(true);
                      setQuery(k);
                    }}
                    className="min-h-9 coarse:min-h-11"
                  >
                    <Badge variant="neutral">{k}</Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {doc.ocrConfidence !== undefined && (
            <Card>
              <CardHeader>
                <CardTitle>حالة OCR</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">دقة الاستخراج</span>
                  <span className="font-mono font-medium text-success">{doc.ocrConfidence}%</span>
                </div>
                <Progress value={doc.ocrConfidence} aria-label="دقة الاستخراج" />
                <p className="text-xs text-muted-foreground">قيمة مسجّلة مع الوثيقة التجريبية؛ لا يعمل محرك OCR في هذه النسخة.</p>
              </CardContent>
            </Card>
          )}

          {can(user, "case:link") && linkableCases.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>ربط بقضية نشطة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={linkTarget} onValueChange={setLinkTarget}>
                  <SelectTrigger aria-label="القضية">
                    <SelectValue placeholder="اختر القضية" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkableCases.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.client} — {c.ref}
                        {isDocumentLinked(doc.id, c.id, db) ? " (مرتبطة)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={linkTarget && isDocumentLinked(doc.id, linkTarget, db) ? "secondary" : "gold"}
                  className="w-full"
                  disabled={!linkTarget || isDocumentLinked(doc.id, linkTarget, db)}
                  onClick={() => setConfirmLink(true)}
                >
                  {linkTarget && isDocumentLinked(doc.id, linkTarget, db) ? <CheckCircle2 className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                  {linkTarget && isDocumentLinked(doc.id, linkTarget, db) ? "مرتبطة بهذه القضية" : "ربط الوثيقة بالقضية"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLink}
        onOpenChange={setConfirmLink}
        title="تأكيد ربط الوثيقة"
        description={`سيتم ربط «${doc.title}» (${doc.caseRef}) بالقضية المختارة وإضافة الحدث إلى سجلها الزمني.`}
        confirmLabel="ربط"
        onConfirm={doLink}
      />
    </AppShell>
  );
}

function PageText({ text, query, activeLocal, start, prefix }: { text: string; query: string; activeLocal: number; start: number; prefix: string }) {
  const terms = query.trim().length >= 2 ? [query.trim()] : [];
  if (!terms.length) return <>{text}</>;
  // Per-paragraph highlighting with globally unique mark ids for scroll targets.
  let offset = 0;
  return (
    <>
      {text.split("\n\n").map((para, i) => {
        const nodes = highlightText(para, terms, activeLocal - offset, undefined);
        const count = countMatches(para, terms[0]);
        const ids = Array.from({ length: count }, (_, k) => `${prefix}-${start + offset + k}`);
        offset += count;
        return (
          <p key={i} className={cn(i > 0 && "mt-4")}>
            <MarkIds ids={ids}>{nodes}</MarkIds>
          </p>
        );
      })}
    </>
  );
}

/** Assigns sequential ids to <mark> children after render (keeps highlightText pure). */
function MarkIds({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll("mark").forEach((m, i) => {
      if (ids[i]) m.id = ids[i];
    });
  });
  return <span ref={ref}>{children}</span>;
}
