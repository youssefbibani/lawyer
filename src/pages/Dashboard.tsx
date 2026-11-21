import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarClock,
  CalendarCheck,
  ListTodo,
  Wallet,
  Upload,
  Search,
  CalendarPlus,
  ReceiptText,
  Sparkles,
  ChevronLeft,
  SendHorizontal,
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
import { Textarea } from "@/components/ui/textarea";
import { urgencyLabelOf, urgencyToneOf } from "@/lib/status";
import { formatArabicDateShort } from "@/lib/formatters";
import { urgencyOf } from "@/lib/dates";
import { useDashboard } from "@/backend/queries";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, caseStatusToneOf } from "@/backend/labels";
import { formatMoney } from "@/backend/format";

const CHART_COLORS = ["#1A1A2E", "#C9A84C", "#9B7627", "#B5402A", "#4d7a5f"];

export default function Dashboard() {
  const navigate = useNavigate();
  const dashboard = useDashboard();
  const taskActions = useTaskActions();
  const [prompt, setPrompt] = useState("");
  const d = dashboard.data;

  const distribution = useMemo(() => (d?.caseTypeDistribution ?? []).map((x) => ({ name: CASE_TYPE_LABELS[x.type], value: x.count })), [d]);
  const outstanding = d?.outstanding;

  function askAssistant(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    navigate(text ? `/app/assistant?prompt=${encodeURIComponent(text)}` : "/app/assistant");
  }

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
              <MetricCard icon={Briefcase} value={String(d.activeCases)} label="القضايا المنشورة" to="/app/cases?status=ACTIVE" />
              <MetricCard icon={CalendarClock} value={String(d.hearingsNext7Days.length)} label="جلسات خلال الأسبوع" to="/app/agenda" />
              <MetricCard
                icon={ListTodo}
                value={String(d.todayTasks.length)}
                label="أعمال اليوم"
                hint={d.overdueTaskCount ? `${d.overdueTaskCount} أعمال متأخرة` : undefined}
                tone={d.overdueTaskCount ? "alert" : "default"}
                to="/app/tasks"
              />
              <MetricCard icon={CalendarCheck} value={String(d.upcomingAppointments)} label="مواعيد الحرفاء" to="/app/appointments" />
              {outstanding && (
                <div className="col-span-2 lg:col-span-1">
                  <MetricCard
                    to="/app/payments"
                    icon={Wallet}
                    value={outstanding.length ? outstanding.map((o) => formatMoney(o.amount, o.currency)).join(" + ") : formatMoney("0")}
                    label="مستحقات غير مدفوعة"
                    tone="gold"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle>أعمال اليوم</CardTitle>
                    <CardDescription>{d.overdueTaskCount ? `${d.overdueTaskCount} أعمال متأخرة تحتاج متابعة` : "لا توجد أعمال متأخرة"}</CardDescription>
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
                    <p className="text-sm text-muted-foreground">لا توجد أعمال مبرمجة لليوم.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.todayTasks.slice(0, 4).map((t) => (
                        <TaskItem key={t.id} task={t} finishing={taskActions.isFinishing(t.id)} onToggle={taskActions.toggle} onEdit={taskActions.openEdit} onDelete={taskActions.setDeleting} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="flex min-h-[22rem] flex-col border-gold/40 bg-night text-cream dark:bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-cream">
                    <Sparkles className="h-5 w-5 text-gold" aria-hidden="true" />
                    المساعد القانوني الذكي
                  </CardTitle>
                  <CardDescription className="text-cream/70">اسأل بالدارجة أو بالفصحى عن ملفاتك ومواعيدك.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <form onSubmit={askAssistant} className="flex flex-1 flex-col gap-3">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) askAssistant(e);
                      }}
                      placeholder="اكتب سؤالك هنا..."
                      aria-label="سؤال للمساعد"
                      className="min-h-28 flex-1 resize-none border-cream/20 bg-cream/5 text-cream placeholder:text-cream/50 focus-visible:ring-gold"
                    />
                    <Button type="submit" variant="gold" className="w-full">
                      <SendHorizontal className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                      {prompt.trim() ? "إرسال إلى المساعد" : "فتح المساعد"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>جلسات الأيام السبعة القادمة</CardTitle>
                  <CardDescription>الجلسات القادمة مرتبة حسب التاريخ</CardDescription>
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
                            {formatArabicDateShort(h.date)}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>قضايا منشورة</CardTitle>
                  <CardDescription>أحدث الملفات قيد المتابعة</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {d.recentCases.length === 0 && <p className="text-sm text-muted-foreground">لا توجد قضايا منشورة.</p>}
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
              <Card className="flex flex-col lg:col-span-2">
                <CardHeader>
                  <CardTitle>إجراءات سريعة</CardTitle>
                  <CardDescription>وصول مباشر إلى المهام الأكثر استخداماً</CardDescription>
                </CardHeader>
                {/* The tiles stretch to fill the whole card, whatever the height of the chart beside it. */}
                <CardContent className="grid flex-1 auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "رفع وثيقة", icon: Upload, to: "/app/archive" },
                    { label: "بحث في الأرشيف", icon: Search, to: "/app/search" },
                    { label: "إضافة جلسة", icon: CalendarPlus, to: "/app/agenda" },
                    { label: "تسجيل دفعة", icon: ReceiptText, to: "/app/payments" },
                    { label: "موعد جديد", icon: CalendarCheck, to: "/app/appointments?new=1" },
                  ].map((a) => (
                    <Button key={a.label} variant="outline" className="h-full min-h-20 flex-col gap-2 whitespace-normal py-4 text-center" onClick={() => navigate(a.to)}>
                      <a.icon className="h-5 w-5 text-gold-deep" />
                      {a.label}
                    </Button>
                  ))}
                  <Button variant="outline" className="h-full min-h-20 flex-col gap-2 whitespace-normal py-4 text-center" onClick={taskActions.openNew}>
                    <ListTodo className="h-5 w-5 text-gold-deep" />
                    عمل مطلوب جديد
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
