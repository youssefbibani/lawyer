import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileText, Plus, Search as SearchIcon } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { NewCaseDialog } from "@/components/cases/NewCaseDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCompact } from "@/hooks/use-media-query";
import { formatArabicDate } from "@/lib/formatters";
import { useCan, useCases } from "@/backend/queries";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, caseStatusToneOf } from "@/backend/labels";
import { useLocalCaseBridge } from "@/backend/local-bridge";
import type { CaseStatus } from "../../shared/api";

const FILTERS: { label: string; value: CaseStatus | "ALL" }[] = [
  { label: "الكل", value: "ALL" },
  { label: "نشطة", value: "ACTIVE" },
  { label: "مؤجلة", value: "POSTPONED" },
  { label: "منتهية", value: "CLOSED" },
];

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function Cases() {
  const navigate = useNavigate();
  const can = useCan();
  const compact = useIsCompact();
  const bridge = useLocalCaseBridge();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = useDebounced(query.trim());

  useEffect(() => setPage(1), [q, statusFilter]);

  const cases = useCases({ q, status: statusFilter === "ALL" ? undefined : statusFilter, page, pageSize: PAGE_SIZE, sort: "updatedAt:desc" });
  const list = cases.data?.items ?? [];
  const total = cases.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const docs = (ref: string) => bridge.documentCount(ref);

  return (
    <AppShell title="القضايا" subtitle="إدارة الملفات ومتابعة مراحل التقاضي">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالحريف، المرجع، المحكمة..." aria-label="بحث في القضايا" className="pr-9" />
          </div>
          {can("case:create") && (
            <Button variant="default" className="hidden sm:inline-flex" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              قضية جديدة
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="تصفية حسب الحالة">
          <span className="text-sm text-muted-foreground">تصفية:</span>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              aria-pressed={statusFilter === f.value}
              className={cn(
                "min-h-9 rounded-sm border px-3 py-1 text-xs font-medium coarse:min-h-11 coarse:px-4 coarse:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                statusFilter === f.value ? "border-gold bg-gold/15 text-gold-deep" : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="mr-auto text-xs text-muted-foreground">{total} قضية</span>
        </div>

        {cases.isPending ? (
          <SkeletonCards count={3} />
        ) : cases.error ? (
          <div role="alert" className="card-elevated space-y-3 p-6 text-center">
            <p className="text-sm text-alert">{cases.error.message}</p>
            <Button variant="outline" onClick={() => void cases.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={SearchIcon} title="لا توجد نتائج" description={q || statusFilter !== "ALL" ? "لم يتم العثور على أي قضية مطابقة لمعايير البحث الحالية." : "لم تُسجَّل أي قضية بعد."} />
        ) : compact ? (
          <ul className="space-y-3" aria-label="قائمة القضايا">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/app/cases/${c.id}`)}
                  className="card-elevated flex w-full items-start gap-3 p-4 text-right transition-colors active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.clients.map((x) => x.fullName).join("، ") || "—"}</span>
                      <StatusBadge label={CASE_STATUS_LABELS[c.status]} tone={caseStatusToneOf(c.status)} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <CaseReference value={c.reference} />
                      <span>{CASE_TYPE_LABELS[c.type]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.court}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
                      <span className="text-muted-foreground">
                        الجلسة القادمة: <span className="font-mono text-foreground">{c.nextHearing ? formatArabicDate(c.nextHearing.date) : "—"}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {docs(c.reference) ?? "—"} وثائق
                      </span>
                    </div>
                  </div>
                  <ChevronLeft className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card-elevated">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المرجع</TableHead>
                  <TableHead>الحريف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المحكمة</TableHead>
                  <TableHead>الجلسة القادمة</TableHead>
                  <TableHead>الوثائق</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => (
                  <TableRow
                    key={c.id}
                    tabIndex={0}
                    onClick={() => navigate(`/app/cases/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/app/cases/${c.id}`);
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <CaseReference value={c.reference} />
                    </TableCell>
                    <TableCell className="font-medium">{c.clients.map((x) => x.fullName).join("، ") || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{CASE_TYPE_LABELS[c.type]}</TableCell>
                    <TableCell className="text-muted-foreground">{c.court}</TableCell>
                    <TableCell className="font-mono text-xs">{c.nextHearing ? `${formatArabicDate(c.nextHearing.date)} ${c.nextHearing.time}` : "—"}</TableCell>
                    <TableCell className="font-mono">{docs(c.reference) ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge label={CASE_STATUS_LABELS[c.status]} tone={caseStatusToneOf(c.status)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-center gap-3" aria-label="صفحات النتائج">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <span className="text-xs text-muted-foreground">
              صفحة {page} من {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </nav>
        )}
      </div>

      {can("case:create") && (
        <Button
          variant="gold"
          size="icon"
          aria-label="قضية جديدة"
          onClick={() => setDialogOpen(true)}
          className="fixed bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+1rem)] left-4 z-30 h-14 w-14 rounded-full shadow-lg sm:hidden coarse:h-14 coarse:w-14"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}
      <NewCaseDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </AppShell>
  );
}
