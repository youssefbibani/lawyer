import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, FileSearch, History, Info, Link2, Lock, RotateCcw, Search, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { highlightText } from "@/components/documents/highlight";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleCases, accessibleDocuments, isDocumentLinked, linkDocumentToCase } from "@/services/api";
import { can } from "@/services/permissions";
import { LocalRetrievalService, type SearchHit, type SearchOptions, type SearchResponse } from "@/services/retrieval";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { relevanceTone } from "@/lib/status";
import { formatArabicDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { LegalCase } from "@/types";

/** Suggested searches (search words, not filters). */
const SUGGESTIONS = ["ميراث", "عقار", "طلاق", "تعقيب", "2019"];
const ALL = "__all__";
const RECENT_KEY = "qasr-al-adala:recent-archive-searches";
const MAX_RECENT = 6;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useLocalStorage<string[]>(RECENT_KEY, []);
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
    setRecent((r) => [trimmed, ...(Array.isArray(r) ? r : []).filter((x) => x !== trimmed)].slice(0, MAX_RECENT));
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

  // Filters apply at once: re-run the current search whenever one changes.
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    if (submittedQuery) runSearch(submittedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, language, docType, year]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function pick(term: string) {
    setQuery(term);
    runSearch(term);
  }

  function resetFilters() {
    setScope("archive");
    setLanguage("all");
    setDocType(ALL);
    setYear(ALL);
  }

  function clearSearch() {
    requestId.current++;
    setQuery("");
    setSubmittedQuery("");
    setResponse(null);
    setState("idle");
    inputRef.current?.focus();
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
        <form onSubmit={handleSubmit} role="search" className="card-elevated space-y-4 p-4 sm:p-5">
          {/* 1. One search bar: field, clear and submit together. */}
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-input bg-background pe-1.5 ps-4 transition-shadow focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/30">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بكلمة أو عبارة: ميراث، طلاق، عقار، صفاقس 2019…"
              aria-label="البحث في الأرشيف"
              enterKeyHint="search"
              type="search"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="مسح البحث"
                onClick={clearSearch}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Button type="submit" className="h-11 shrink-0 px-5 sm:px-7" disabled={!query.trim()}>
              بحث
            </Button>
          </div>

          {/* 2. Filters: always visible, one tap each, applied immediately. */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-4">
            <Segmented
              label="أين أبحث؟"
              value={scope}
              onChange={setScope}
              options={[
                { value: "archive", label: "الأرشيف", hint: "الملفات المنتهية" },
                { value: "all", label: "كل الوثائق", hint: "بما فيها القضايا الجارية" },
              ]}
            />
            <Segmented
              label="اللغة"
              value={language}
              onChange={setLanguage}
              options={[
                { value: "all", label: "الكل" },
                { value: "ar", label: "العربية" },
                { value: "fr", label: "Français" },
              ]}
            />
            <FilterSelect label="نوع الوثيقة" value={docType} onChange={setDocType} allLabel="كل الأنواع" options={docTypes} />
            <FilterSelect label="السنة" value={year} onChange={setYear} allLabel="كل السنوات" options={years} narrow />
            {activeFilterCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="col-span-2 h-10 justify-self-start text-muted-foreground">
                <RotateCcw className="h-4 w-4" />
                إعادة ضبط المرشحات ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* 3. What the search does, in plain words. */}
          <p className="flex items-start gap-2 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            يبحث داخل نصّ الوثائق المصوّرة بالعربية والفرنسية، ويجد الكلمات المرادفة (مثلاً: ميراث ↔ succession). تظهر فقط الملفات المسموح لك بالاطلاع عليها.
          </p>
        </form>

        {state === "idle" && (
          <div className="space-y-5">
            <div className="space-y-4 rounded-[var(--radius)] border border-dashed border-border p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15">
                  <FileSearch className="h-5 w-5 text-gold-deep" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-heading text-lg">ابدأ البحث في الأرشيف</h2>
                  <p className="text-sm text-muted-foreground">اكتب كلمة أو عبارة، أو اختر إحدى الاقتراحات.</p>
                </div>
              </div>
              <SearchChips title="اقتراحات" items={SUGGESTIONS} onPick={pick} />
              {recent.length > 0 && (
                <SearchChips title="عمليات بحث أخيرة" items={recent} onPick={pick} icon={History} onClear={() => setRecent([])} />
              )}
            </div>
          </div>
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
            description={
              activeFilterCount
                ? `لا توجد وثائق مطابقة لـ«${submittedQuery}» مع المرشحات المختارة. جرّب إعادة ضبط المرشحات.`
                : `لم يتم العثور على وثائق مطابقة لـ«${submittedQuery}» ضمن الوثائق المصرّح لك بها. جرّب كلمات أخرى.`
            }
            action={
              activeFilterCount ? (
                <Button variant="outline" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" />
                  إعادة ضبط المرشحات
                </Button>
              ) : (
                <Button variant="outline" onClick={clearSearch}>
                  مسح البحث
                </Button>
              )
            }
          />
        )}

        {state === "results" && response && (
          <div className="space-y-4" aria-live="polite">
            <div>
              <h2 className="font-heading text-lg">تم العثور على {hits.length} نتائج</h2>
              <p className="text-sm text-muted-foreground">
                لـ«{submittedQuery}» • مرتبة حسب الأهمية
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
                            ربط بقضية منشورة
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
            <DialogTitle>ربط بقضية منشورة</DialogTitle>
            <DialogDescription>اختر القضية المنشورة التي تريد ربط وثيقة {activeResult?.document.caseRef} بها.</DialogDescription>
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

/** A small set of mutually exclusive choices shown as one-tap buttons (instead of a dropdown). */
function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-secondary/60 p-0.5 sm:inline-flex sm:w-auto coarse:h-11">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={o.hint}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-[calc(var(--radius)-2px)] px-3 text-sm transition-colors sm:flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
                selected ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Dropdown filter for open-ended lists (document type, year); highlighted when narrowed. */
function FilterSelect({ label, value, onChange, allLabel, options, narrow }: { label: string; value: string; onChange: (v: string) => void; allLabel: string; options: string[]; narrow?: boolean }) {
  const active = value !== ALL;
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className={cn("h-10 w-full coarse:h-11", narrow ? "sm:w-36" : "sm:w-44", active && "border-gold bg-gold/10 font-medium")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Clickable search terms (suggestions or recent searches). */
function SearchChips({ title, items, onPick, icon: Icon = Search, onClear }: { title: string; items: string[]; onPick: (term: string) => void; icon?: LucideIcon; onClear?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {onClear && (
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            مسح
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onPick(term)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm text-foreground/80 transition-colors hover:border-gold/60 hover:bg-gold/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}
