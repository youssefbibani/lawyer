import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarClock,
  Archive,
  ListTodo,
  Wallet,
  Upload,
  Search,
  CalendarPlus,
  ReceiptText,
  Sparkles,
  ChevronLeft,
  AlertTriangle,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/shared/MetricCard";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { TaskItem } from "@/components/tasks/TaskItem";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTaskActions } from "@/components/tasks/useTaskActions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleDocuments } from "@/services/api";
import { urgencyLabelOf, urgencyToneOf } from "@/lib/status";
import { formatArabicDateShort } from "@/lib/formatters";
import { urgencyOf } from "@/lib/dates";
import { useDashboard } from "@/backend/queries";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, caseStatusToneOf } from "@/backend/labels";
import { formatMoney } from "@/backend/format";

const CHART_COLORS = ["#1A1A2E", "#C9A84C", "#9B7627", "#B5402A", "#4d7a5f"];
const SUGGESTIONS = ["شنوة الجلسات اللي عندي الأسبوع الجاي؟", "ورّيني الأتعاب اللي مازالت ما تخلّصتش", "فتّشلي على حكم قديم في نزاع ميراث"];

export default function Dashboard() {
  const navigate = useNavigate();
  const dashboard = useDashboard();
  // The archive (documents) module still runs on the local demo store; its metric is unchanged.
  const db = useDB();
  const demoUser = useCurrentUser();
  const documentCount = useMemo(() => accessibleDocuments(db, demoUser).length, [db, demoUser]);
  const taskActions = useTaskActions();
  const d = dashboard.data;

  const distribution = useMemo(() => (d?.caseTypeDistribution ?? []).map((x) => ({ name: CASE_TYPE_LABELS[x.type], value: x.count })), [d]);
  const outstanding = d?.outstanding;

  return (
    <AppShell title="لوحة التحكم" subtitle="نظرة شاملة على نشاط المكتب">
      {dashboard.isPending ? (
        <SkeletonCards count={4} />
      ) : dashboard.error ? (
        <div role="alert" className="card-elevated space-y-3 p-6 text-center">
          <p className="text-sm text-alert">{dashboard.error.message}</p>
          <Button variant="outline" onClick={() => void dashboard.refetch()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        d && (
          <div className="space-y-6 sm:space-y-8">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
              <MetricCard icon={Briefcase} value={String(d.activeCases)} label="قضية نشطة" />
              <MetricCard icon={CalendarClock} value={String(d.hearingsNext7Days.length)} label="جلسات خلال 7 أيام" />
              <MetricCard
                icon={ListTodo}
                value={String(d.todayTasks.length)}
                label="مهام اليوم"
                hint={d.overdueTaskCount ? `${d.overdueTaskCount} مهام متأخرة` : undefined}
                tone={d.overdueTaskCount ? "alert" : "default"}
              />
              <MetricCard icon={Archive} value={String(documentCount)} label="وثيقة متاحة" />
              {outstanding && (
                <div className="col-span-2 lg:col-span-1">
                  <MetricCard
                    icon={Wallet}
                    value={outstanding.length ? outstanding.map((o) => formatMoney(o.amount, o.currency)).join(" + ") : formatMoney("0")}
                    label="مستحقات غير مدفوعة"
                    tone="gold"
                  />
                </div>
              )}
            </div>

            {d.conflictGroups.length > 0 && (
              <Link
                to="/app/agenda"
                className="flex items-center gap-3 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-4 text-sm text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1">يوجد {d.conflictGroups.length === 1 ? "تعارض واحد" : `${d.conflictGroups.length} تعارضات`} في الجلسات القادمة — مراجعة المفكرة</span>
                <ChevronLeft className="h-5 w-5 shrink-0" />
              </Link>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle>مهام اليوم</CardTitle>
                    <CardDescription>{d.overdueTaskCount ? `${d.overdueTaskCount} مهام متأخرة تحتاج متابعة` : "لا توجد مهام متأخرة"}</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/app/tasks">
                      الكل
                      <ChevronLeft className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {d.todayTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">لا توجد مهام مبرمجة لليوم.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.todayTasks.slice(0, 4).map((t) => (
                        <TaskItem key={t.id} task={t} onToggle={taskActions.toggle} onEdit={taskActions.openEdit} onDelete={taskActions.setDeleting} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gold/40 bg-night text-cream dark:bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-cream">
                    <Sparkles className="h-5 w-5 text-gold" aria-hidden="true" />
                    المساعد القانوني الذكي
                  </CardTitle>
                  <CardDescription className="text-cream/70">اسأل بالدارجة أو بالفصحى عن ملفاتك ومواعيدك.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <Link
                      key={s}
                      to={`/app/assistant?prompt=${encodeURIComponent(s)}`}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius)] border border-cream/15 px-3 py-2 text-sm text-cream/90 transition-colors hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                      <span className="min-w-0">{s}</span>
                      <ChevronLeft className="h-4 w-4 shrink-0 text-gold" />
                    </Link>
                  ))}
                  <Button variant="gold" className="mt-2 w-full" onClick={() => navigate("/app/assistant")}>
                    فتح المساعد
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>جلسات الأيام السبعة القادمة</CardTitle>
                  <CardDescription>المواعيد القادمة مرتبة حسب التاريخ (بتوقيت تونس)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {d.hearingsNext7Days.length === 0 && <p className="text-sm text-muted-foreground">لا توجد جلسات خلال الأسبوع.</p>}
                  {d.hearingsNext7Days.map((h) => {
                    const urgency = urgencyOf(h.date);
                    return (
                      <Link
                        key={h.id}
                        to={`/app/cases/${h.caseId}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border p-3 transition-colors hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <StatusBadge label={urgencyLabelOf(urgency)} tone={urgencyToneOf(urgency)} />
                          <CaseReference value={h.caseReference} />
                          <span className="text-sm text-foreground">{h.clientName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{h.room}</span>
                          <span className="font-mono" dir="ltr">
                            {formatArabicDateShort(h.date)} — {h.time}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>قضايا نشطة</CardTitle>
                  <CardDescription>أحدث الملفات قيد المتابعة</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {d.recentCases.length === 0 && <p className="text-sm text-muted-foreground">لا توجد قضايا نشطة.</p>}
                  {d.recentCases.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/app/cases/${c.id}`)}
                      className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border p-3 text-right transition-colors hover:border-gold/50 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <CaseReference value={c.reference} />
                        <span className="text-sm font-medium">{c.clients[0]?.fullName ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">{CASE_TYPE_LABELS[c.type]}</span>
                      </div>
                      <StatusBadge label={CASE_STATUS_LABELS[c.status]} tone={caseStatusToneOf(c.status)} />
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>إجراءات سريعة</CardTitle>
                  <CardDescription>وصول مباشر إلى المهام الأكثر استخداماً</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    { label: "رفع وثيقة", icon: Upload, to: "/app/archive" },
                    { label: "بحث في الأرشيف", icon: Search, to: "/app/search" },
                    { label: "إضافة جلسة", icon: CalendarPlus, to: "/app/agenda" },
                    { label: "تسجيل دفعة", icon: ReceiptText, to: "/app/payments" },
                  ].map((a) => (
                    <Button key={a.label} variant="outline" className="h-auto min-h-20 flex-col gap-2 whitespace-normal py-4 text-center" onClick={() => navigate(a.to)}>
                      <a.icon className="h-5 w-5 text-gold-deep" />
                      {a.label}
                    </Button>
                  ))}
                  <Button variant="outline" className="h-auto min-h-20 flex-col gap-2 whitespace-normal py-4 text-center" onClick={taskActions.openNew}>
                    <ListTodo className="h-5 w-5 text-gold-deep" />
                    مهمة جديدة
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>توزيع القضايا</CardTitle>
                  <CardDescription>حسب نوع القضية</CardDescription>
                </CardHeader>
                <CardContent>
                  {distribution.length === 0 ? (
                    <p className="text-sm text-muted-foreground">لا توجد قضايا بعد.</p>
                  ) : (
                    <>
                      <div className="h-48" role="img" aria-label={distribution.map((x) => `${x.name}: ${x.value}`).join("، ")}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                              {distribution.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <ChartTooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs">
                        {distribution.map((entry, i) => (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-muted-foreground">{entry.name}</span>
                            <span className="mr-auto font-mono">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )
      )}

      <TaskDialog open={taskActions.dialogOpen} onOpenChange={taskActions.setDialogOpen} task={taskActions.editing} />
      <ConfirmDialog
        open={!!taskActions.deleting}
        onOpenChange={(o) => !o && taskActions.setDeleting(undefined)}
        title="حذف المهمة"
        description={`سيتم حذف «${taskActions.deleting?.title ?? ""}» من القوائم (يبقى أثرها في سجل العمليات).`}
        confirmLabel="حذف"
        tone="destructive"
        onConfirm={taskActions.confirmDelete}
      />
    </AppShell>
  );
}
