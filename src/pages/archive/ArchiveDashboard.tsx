import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Archive, CheckCircle2, ChevronLeft, Clock, FileStack, FolderPlus, HardDrive, Info, ScanText, Wrench } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/shared/MetricCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { getMember, getTeam } from "@/services/api";
import { can } from "@/services/permissions";
import { accessibleBatches } from "@/services/archive/service";
import { MONITOR_BUCKETS } from "@/services/archive/workflow";
import { getBlobStore } from "@/services/archive/blobStore";
import { getOcrProvider } from "@/services/archive/ocr";
import { normalizeText } from "@/lib/arabic";
import { formatRelativeDay } from "@/lib/formatters";
import type { ArchiveBatch, ArchiveItem } from "@/types";

const BATCH_STATUS: Record<ArchiveBatch["status"], { label: string; tone: "neutral" | "gold" | "success" }> = {
  draft: { label: "مسودة", tone: "neutral" },
  in_progress: { label: "قيد العمل", tone: "gold" },
  completed: { label: "مكتملة", tone: "success" },
};

const ICONS = [Clock, ScanText, CheckCircle2, Archive, Wrench];

export function bucketCounts(items: ArchiveItem[]) {
  return MONITOR_BUCKETS.map((b) => ({ ...b, count: items.filter((i) => !i.excluded && b.states.includes(i.state)).length }));
}

export default function ArchiveDashboard() {
  const navigate = useNavigate();
  const db = useDB();
  const user = useCurrentUser();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [responsible, setResponsible] = useState("all");
  const batches = useMemo(() => accessibleBatches(db), [db]);
  const allItems = useMemo(() => db.archiveItems.filter((i) => i.tenantId === db.tenantId), [db]);
  const store = getBlobStore();
  const ocr = getOcrProvider();

  const filtered = batches.filter(
    (b) =>
      (status === "all" || b.status === status) &&
      (responsible === "all" || b.responsibleId === responsible) &&
      (!query.trim() || normalizeText(`${b.name} ${b.reference} ${b.location}`).includes(normalizeText(query))),
  );

  if (!can(user, "archive:process")) {
    return (
      <AppShell title="الأرشفة الذكية">
        <EmptyState icon={Archive} title="غير مصرّح" description="معالجة الأرشيف متاحة للمحامين وكتبة المكتب والإدارة." />
      </AppShell>
    );
  }

  const totals = bucketCounts(allItems);

  return (
    <AppShell title="الأرشفة الذكية" subtitle="رقمنة الوثائق الورقية ومتابعة دفعات الأرشفة">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">رفع ← استخراج ← تصنيف ← مراجعة ← ربط ← موافقة ← حفظ نهائي</p>
          <Button onClick={() => navigate("/app/archive/new")} className="w-full sm:w-auto">
            <FolderPlus className="h-4 w-4" />
            إنشاء دفعة أرشفة
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 2xl:grid-cols-6">
          <MetricCard icon={FileStack} value={String(allItems.length)} label="إجمالي الوثائق" />
          {totals.map((b, i) => (
            <MetricCard key={b.key} icon={ICONS[i]} value={String(b.count)} label={b.label} tone={b.key === "correction" && b.count ? "alert" : b.key === "ready" && b.count ? "gold" : "default"} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <p className={`flex items-start gap-2 rounded-[var(--radius)] border p-3 text-xs leading-6 ${store.persistent ? "border-border bg-muted/40 text-muted-foreground" : "border-alert/30 bg-alert/10 text-alert"}`}>
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {store.persistent
              ? "الأصول محفوظة في تخزين هذا المتصفح (IndexedDB) ومشفّرة بمفتاح غير قابل للتصدير، ولا تُحذف أبداً. التخزين المركزي على الخادم يتطلب ربطاً خارجياً."
              : "تنبيه: هذا المتصفح لا يدعم التخزين الدائم للأصول — ستُفقد الملفات عند إغلاق الصفحة. استعمل متصفحاً حديثاً."}
          </p>
          <p className={`flex items-start gap-2 rounded-[var(--radius)] border p-3 text-xs leading-6 ${ocr ? "border-border bg-muted/40 text-muted-foreground" : "border-alert/30 bg-alert/10 text-alert"}`}>
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {ocr
              ? `محرك استخراج النص: ${ocr.label}. ${ocr.local ? "الصور لا تغادر الجهاز؛ أول تشغيل يحمّل نماذج اللغة." : "تُرسل الصفحات إلى خادم المكتب."}`
              : "لا يوجد محرك OCR مهيأ: ستفشل مرحلة الاستخراج بوضوح بدل اختلاق نتائج."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو المرجع أو المكان..." aria-label="بحث في الدفعات" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="حالة الدفعة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {(Object.keys(BATCH_STATUS) as ArchiveBatch["status"][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {BATCH_STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={responsible} onValueChange={setResponsible}>
            <SelectTrigger aria-label="الموظف المسؤول">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الموظفين</SelectItem>
              {getTeam().map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Archive} title="لا توجد دفعات" description="أنشئ دفعة أرشفة لبدء رقمنة علبة أو ملف ورقي." />
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((b) => {
              const items = allItems.filter((i) => i.batchId === b.id);
              const active = items.filter((i) => !i.excluded);
              const archived = active.filter((i) => i.state === "archived").length;
              const pct = active.length ? Math.round((archived / active.length) * 100) : 0;
              const failed = items.filter((i) => i.state === "failed" || i.state === "needs_correction");
              const counts = bucketCounts(items);
              return (
                <li key={b.id} className="card-elevated flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/app/archive/batches/${b.id}`} className="inline-flex items-center font-heading text-lg leading-snug underline-offset-2 hover:underline coarse:min-h-11">
                        {b.name}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="ref-tag">{b.reference}</span>
                        <span>{b.location}</span>
                      </p>
                    </div>
                    <StatusBadge label={BATCH_STATUS[b.status].label} tone={BATCH_STATUS[b.status].tone} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        مؤرشفة {archived} من {active.length}
                        {b.expectedCount ? ` — المتوقع ${b.expectedCount}` : ""}
                      </span>
                      <span className="font-mono">{pct}%</span>
                    </div>
                    <Progress value={pct} aria-label={`تقدم الدفعة ${b.name}`} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {counts.filter((c) => c.count).map((c) => (
                      <span key={c.key} className="rounded-sm bg-muted px-1.5 py-0.5">
                        {c.label}: {c.count}
                      </span>
                    ))}
                  </div>
                  {failed.length > 0 && (
                    <p className="flex items-start gap-2 rounded-sm bg-alert/10 p-2 text-xs text-alert">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {failed.length} وثائق تحتاج تدخلاً{failed[0].error ? ` — ${failed[0].error}` : failed[0].review?.returnReason ? ` — ${failed[0].review.returnReason}` : ""}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      المسؤول: {getMember(b.responsibleId)?.name} • آخر تحديث {formatRelativeDay(b.updatedAt.slice(0, 10))}
                    </span>
                    <Button size="sm" onClick={() => navigate(`/app/archive/batches/${b.id}`)}>
                      متابعة
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
