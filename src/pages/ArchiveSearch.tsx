import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, FileSearch, Info, Link2, Lock, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { highlightText } from "@/components/documents/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleCases, accessibleDocuments, isDocumentLinked, linkDocumentToCase } from "@/services/api";
import { can } from "@/services/permissions";
import { LocalRetrievalService, type SearchHit, type SearchOptions, type SearchResponse } from "@/services/retrieval";
import { relevanceTone } from "@/lib/status";
import { formatArabicDate } from "@/lib/formatters";
import type { LegalCase } from "@/types";

const POPULAR_FILTERS = ["ميراث", "عقار", "طلاق", "تعقيب", "2019"];
const ALL = "__all__";
const retrieval = new LocalRetrievalService(350);

type SearchState = "idle" | "loading" | "results" | "empty";

export default function ArchiveSearch() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const db = useDB();
  const user = useCurrentUser();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scope, setScope] = useState<"archive" | "all">("archive");
  const [language, setLanguage] = useState<"all" | "ar" | "fr">("all");
  const [docType, setDocType] = useState<string>(ALL);
  const [year, setYear] = useState<string>(ALL);
  const [activeResult, setActiveResult] = useState<SearchHit | null>(null);
  const [linkCase, setLinkCase] = useState<LegalCase | null>(null);
  const requestId = useRef(0);

  const docs = useMemo(() => accessibleDocuments(db, user), [db, user]);
  const docTypes = useMemo(() => [...new Set(docs.map((d) => d.docType))], [docs]);
  const years = useMemo(() => [...new Set(docs.map((d) => d.date.slice(0, 4)))].sort().reverse(), [docs]);
  const activeFilterCount = Number(scope !== "archive") + Number(language !== "all") + Number(docType !== ALL) + Number(year !== ALL);

  function runSearch(term: string, overrides: Partial<SearchOptions> = {}) {
    const trimmed = term.trim();
    if (!trimmed) return;
    const id = ++requestId.current;
    setSubmittedQuery(trimmed);
    setState("loading");
    const options: SearchOptions = {
      scope,
      language,
      docType: docType === ALL ? undefined : docType,
      year: year === ALL ? undefined : year,
      ...overrides,
    };
    retrieval.search(trimmed, options).then((res) => {
      if (id !== requestId.current) return; // a newer search superseded this one
      setResponse(res);
      setState(res.hits.length ? "results" : "empty");
    });
  }

  // ?q= from the header quick search
  useEffect(() => {
    const q = params.get("q");
    if (q) {
      setQuery(q);
      runSearch(q);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function clearSearch() {
    requestId.current++;
    setQuery("");
    setSubmittedQuery("");
    setResponse(null);
    setState("idle");
  }

  function confirmLink() {
    if (!activeResult || !linkCase) return;
    const result = linkDocumentToCase(activeResult.document.id, linkCase.id);
    if (result.ok) toast.success(`تم الربط بقضية ${linkCase.client}`, { description: "أضيف الحدث إلى السجل الزمني للقضية." });
    else toast.error(result.error);
    setLinkCase(null);
    setActiveResult(null);
  }

  if (!can(user, "document:read")) {
    return (
      <AppShell title="البحث الذكي في الأرشيف">
        <EmptyState icon={Lock} title="غير مصرّح" description="ليست لديك صلاحية الاطلاع على وثائق الأرشيف." />
      </AppShell>
    );
  }

  const hits = response?.hits ?? [];

  return (
    <AppShell title="البحث الذكي في الأرشيف" subtitle="بحث في النصوص المستخرجة بالعربية والفرنسية">
      <div className="space-y-5 sm:space-y-6">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          بحث في نصوص OCR مع توحيد الكتابة العربية وتوسيع المرادفات بين العربية والفرنسية. النتائج مقتصرة على الملفات المصرّح لك بها.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3" role="search">
          <div className="relative">
            <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث في الأرشيف: طلاق، ميراث، عقار، صفاقس 2019..."
              aria-label="البحث في الأرشيف"
              enterKeyHint="search"
              className="h-14 pr-12 text-base coarse:h-14"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">مرشحات شائعة:</span>
            {POPULAR_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setQuery(f);
                  runSearch(f);
                }}
                className="min-h-9 rounded-sm border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold-deep coarse:min-h-11 coarse:px-3.5 coarse:text-sm"
              >
                {f}
              </button>
            ))}
            <div className="mr-auto flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
                <SlidersHorizontal className="h-4 w-4" />
                المرشحات{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </Button>
              <Button type="submit" size="sm">
                بحث
              </Button>
            </div>
          </div>

          {filtersOpen && (
            <div className="grid grid-cols-1 gap-3 rounded-[var(--radius)] border border-border p-3 xs:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>النطاق</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as "archive" | "all")}>
                  <SelectTrigger aria-label="النطاق">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="archive">الأرشيف (ملفات منتهية)</SelectItem>
                    <SelectItem value="all">كل الوثائق بما فيها القضايا الجارية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>اللغة</Label>
                <Select value={language} onValueChange={(v) => setLanguage(v as "all" | "ar" | "fr")}>
                  <SelectTrigger aria-label="اللغة">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">العربية والفرنسية</SelectItem>
                    <SelectItem value="ar">العربية فقط</SelectItem>
                    <SelectItem value="fr">الفرنسية فقط</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>نوع الوثيقة</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger aria-label="نوع الوثيقة">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>كل الأنواع</SelectItem>
                    {docTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>السنة</Label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger aria-label="السنة">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>كل السنوات</SelectItem>
                    {years.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {submittedQuery && state !== "idle" && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary px-2.5 py-1 text-xs">
                {submittedQuery}
                <button type="button" aria-label="مسح البحث" onClick={clearSearch} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted coarse:h-11 coarse:w-11">
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
        </form>

        {state === "idle" && (
          <EmptyState
            icon={FileSearch}
            title="ابدأ البحث في الأرشيف"
            description="اكتب كلمة أو عبارة، أو اختر من المرشحات الشائعة أعلاه، للعثور على الوثائق ذات الصلة."
          />
        )}

        {state === "loading" && (
          <div aria-live="polite">
            <p className="sr-only">جارٍ البحث...</p>
            <SkeletonCards count={3} />
          </div>
        )}

        {state === "empty" && (
          <EmptyState
            icon={FileSearch}
            title="لا توجد نتائج"
            description={`لم يتم العثور على وثائق مطابقة لـ «${submittedQuery}» ضمن الوثائق المصرّح لك بها. جرّب كلمات مفتاحية أخرى أو وسّع المرشحات.`}
            action={
              <Button variant="outline" onClick={clearSearch}>
                مسح البحث
              </Button>
            }
          />
        )}

        {state === "results" && response && (
          <div className="space-y-4" aria-live="polite">
            <div>
              <h2 className="font-heading text-lg">تم العثور على {hits.length} نتائج</h2>
              <p className="text-sm text-muted-foreground">
                مرتبة حسب الأهمية
                {response.expandedTerms.length > 0 && ` • شمل البحث: ${response.expandedTerms.slice(0, 5).join("، ")}`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {hits.map((hit) => {
                const doc = hit.document;
                const terms = [...response.terms, ...hit.bestPage.highlights];
                return (
                  <Card key={doc.id} className="animate-fade-in">
                    <CardContent className="space-y-3 p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <CaseReference value={doc.caseRef} />
                          <span className="text-sm font-medium">{doc.client}</span>
                          <span className="text-xs text-muted-foreground">{doc.docType}</span>
                          <span className="font-mono text-xs text-muted-foreground">{formatArabicDate(doc.date)}</span>
                        </div>
                        <StatusBadge label={hit.relevance} tone={relevanceTone(hit.relevance)} />
                      </div>
                      <p className="font-legal text-sm leading-7 text-foreground/90" dir={hit.bestPage.lang === "fr" ? "ltr" : "rtl"} lang={hit.bestPage.lang}>
                        {highlightText(hit.bestPage.snippet, terms)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>صفحات مطابقة:</span>
                        {(hit.pages.length ? hit.pages : [hit.bestPage]).map((p) => (
                          <Link
                            key={p.page}
                            to={`/app/document/${doc.id}?page=${p.page}&q=${encodeURIComponent(response.terms[0] ?? "")}`}
                            className="inline-flex min-h-8 items-center rounded-sm border border-border px-2 font-mono hover:border-gold/50 coarse:min-h-11 coarse:px-3"
                            aria-label={`فتح الصفحة ${p.page}${p.lang === "fr" ? " (بالفرنسية)" : ""}`}
                          >
                            ص {p.page}
                            {p.lang === "fr" && <span className="mr-1 text-[10px]">FR</span>}
                          </Link>
                        ))}
                        {hit.expansionOnly && <span className="text-gold-deep">تطابق عبر المرادفات فقط</span>}
                      </div>
                      {doc.verified && (
                        <p className="flex items-center gap-1.5 text-xs text-success">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          وثيقة موثّقة: رُوجعت بياناتها واعتُمدت أرشفتها من طرف شخص مخوّل
                        </p>
                      )}
                      {hit.injectionSuspected && (
                        <p className="flex items-start gap-2 text-xs text-alert">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          تحتوي الوثيقة على عبارات تشبه تعليمات لنظام آلي: تُعامل كنص غير موثوق.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => navigate(`/app/document/${doc.id}?page=${hit.bestPage.page}&q=${encodeURIComponent(response.terms[0] ?? "")}`)}
                        >
                          عرض الوثيقة
                        </Button>
                        {can(user, "case:link") && (
                          <Button size="sm" variant="outline" onClick={() => setActiveResult(hit)}>
                            <Link2 className="h-4 w-4" />
                            ربط بقضية نشطة
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!activeResult && !linkCase} onOpenChange={(o) => !o && setActiveResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ربط بقضية نشطة</DialogTitle>
            <DialogDescription>اختر القضية النشطة التي تريد ربط وثيقة {activeResult?.document.caseRef} بها.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {accessibleCases(db, user)
              .filter((c) => c.status === "نشطة")
              .map((c) => {
                const linked = activeResult ? isDocumentLinked(activeResult.document.id, c.id, db) || activeResult.document.caseId === c.id : false;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={linked}
                    onClick={() => setLinkCase(c)}
                    className="flex min-h-12 w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-border p-3 text-right text-sm transition-colors hover:border-gold/50 hover:bg-secondary/50 disabled:opacity-60"
                  >
                    <span className="min-w-0 truncate">
                      {c.client}
                      {linked && <span className="mr-2 text-xs text-muted-foreground">(مرتبطة)</span>}
                    </span>
                    <CaseReference value={c.ref} />
                  </button>
                );
              })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveResult(null)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!linkCase}
        onOpenChange={(o) => !o && setLinkCase(null)}
        title="تأكيد الربط"
        description={`سيتم ربط «${activeResult?.document.title ?? ""}» بقضية ${linkCase?.client ?? ""} (${linkCase?.ref ?? ""}).`}
        confirmLabel="ربط"
        onConfirm={confirmLink}
      />
    </AppShell>
  );
}
