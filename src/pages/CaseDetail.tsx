import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  FileQuestion,
  FilePlus,
  CalendarPlus,
  BellPlus,
  ReceiptText,
  FileText,
  Calendar as CalendarIcon,
  CheckCircle2,
  MessageSquare,
  Gavel,
  ListTodo,
  ChevronLeft,
  Sparkles,
  ScrollText,
  Plus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { CaseReference } from "@/components/shared/CaseReference";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { TaskDialog, type TaskDefaults } from "@/components/tasks/TaskDialog";
import { TaskItem } from "@/components/tasks/TaskItem";
import { useTaskActions } from "@/components/tasks/useTaskActions";
import { HearingDialog } from "@/components/hearings/HearingDialog";
import { HearingActions } from "@/components/hearings/HearingActions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCompact } from "@/hooks/use-media-query";
import { urgencyLabelOf, urgencyToneOf } from "@/lib/status";
import { formatArabicDate } from "@/lib/formatters";
import { urgencyOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCase, useCaseNotes, useCaseTimeline, useFees, useHearings, useTasks } from "@/backend/queries";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, HEARING_STATUS_LABELS, SETTLEMENT_LABELS, caseStatusToneOf, settlementTone } from "@/backend/labels";
import { formatMoney, isZeroOrLess, percentOf, sumMoney } from "@/backend/format";
import { useLocalCaseBridge } from "@/backend/local-bridge";
import { CASE_STATUSES, type CaseDetailDTO, type CaseStatus, type SettlementStatus } from "../../shared/api";

const noteSchema = z.object({ content: z.string().trim().min(1, "يرجى إدخال نص الملاحظة") });
type NoteValues = z.infer<typeof noteSchema>;

const timelineIcons = { file: FileText, calendar: CalendarIcon, check: CheckCircle2, message: MessageSquare, gavel: Gavel, task: ListTodo };

function iconFor(resourceType: string): keyof typeof timelineIcons {
  if (resourceType === "hearing" || resourceType === "reminder") return "calendar";
  if (resourceType === "task") return "task";
  if (resourceType === "note") return "message";
  if (["payment", "receipt", "fee_agreement"].includes(resourceType)) return "check";
  return "file";
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const compact = useIsCompact();
  const bridge = useLocalCaseBridge();
  const caseQuery = useCase(id);
  const legalCase = caseQuery.data;
  const notes = useCaseNotes(legalCase?.id);
  const timeline = useCaseTimeline(legalCase?.id);
  const hearings = useHearings({ caseId: legalCase?.id }, !!legalCase);
  const tasks = useTasks({ caseId: legalCase?.id }, !!legalCase);
  const fees = useFees({ caseId: legalCase?.id }, !!legalCase?.can.finance);

  const [tab, setTab] = useState("overview");
  const [hearingDialogOpen, setHearingDialogOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const taskActions = useTaskActions();

  const localCase = bridge.localCase(legalCase?.reference);
  const documents = useMemo(() => bridge.documents(legalCase?.reference), [bridge, legalCase?.reference]);

  const noteForm = useForm<NoteValues>({ resolver: zodResolver(noteSchema), defaultValues: { content: "" } });
  const addNote = useApiMutation((content: string) => api.post(`/cases/${legalCase!.id}/notes`, { content }), ["cases"]);
  const changeStatus = useApiMutation((status: CaseStatus) => api.post<CaseDetailDTO>(`/cases/${legalCase!.id}/status`, { status, version: legalCase!.version }), ["cases"]);

  const caseTasks = useMemo(
    () => [...(tasks.data?.items ?? [])].sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE") || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [tasks.data],
  );

  const feeSummary = useMemo(() => {
    const active = (fees.data?.items ?? []).filter((f) => f.status !== "CANCELLED");
    if (!active.length) return null;
    const currency = active[0].currency;
    const sameCurrency = active.filter((f) => f.currency === currency);
    const agreed = sumMoney(sameCurrency.map((f) => f.amount));
    const paid = sumMoney(sameCurrency.map((f) => f.paid));
    const remaining = sumMoney(sameCurrency.map((f) => f.remaining));
    const settlement: SettlementStatus = isZeroOrLess(remaining) ? "PAID" : !isZeroOrLess(paid) ? "PARTIAL" : "UNPAID";
    const last = sameCurrency.map((f) => f.lastPaymentOn).filter(Boolean).sort().at(-1) ?? null;
    return { currency, agreed, paid, remaining, settlement, last, mixed: sameCurrency.length !== active.length };
  }, [fees.data]);

  if (caseQuery.isPending) {
    return (
      <AppShell title="القضية" backTo="/app/cases">
        <SkeletonCards count={3} />
      </AppShell>
    );
  }

  if (!legalCase) {
    const missing = isApiError(caseQuery.error, "NOT_FOUND") || !caseQuery.error;
    return (
      <AppShell title="القضية غير متاحة" backTo="/app/cases">
        <EmptyState
          icon={FileQuestion}
          title={missing ? "تعذر العثور على القضية" : "تعذر تحميل القضية"}
          description={missing ? "قد يكون المرجع غير صحيح، أو أنك غير مكلّف بهذا الملف." : caseQuery.error!.message}
          action={<Button onClick={() => navigate("/app/cases")}>العودة إلى قائمة القضايا</Button>}
        />
      </AppShell>
    );
  }

  const clientNames = legalCase.clients.map((c) => c.fullName).join("، ") || "—";
  const openTasks = caseTasks.filter((t) => t.status === "OPEN").length;
  const reminderDefaults: TaskDefaults = { kind: "REMINDER", caseId: legalCase.id, title: `متابعة ملف ${clientNames}`, dueTime: "09:00" };

  function onAddNote(values: NoteValues) {
    addNote.mutate(values.content, {
      onSuccess: () => {
        noteForm.reset();
        toast.success("تمت إضافة الملاحظة");
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const quickActions = [
    { label: "إضافة وثيقة", icon: FilePlus, onClick: () => navigate(localCase ? `/app/archive/new?case=${localCase.id}` : "/app/archive/new"), show: true },
    {
      label: "تحديد جلسة",
      icon: CalendarPlus,
      onClick: () => {
        setTab("hearings");
        setHearingDialogOpen(true);
      },
      show: legalCase.can.scheduleHearing && legalCase.status !== "CLOSED",
    },
    { label: "إنشاء تذكير", icon: BellPlus, onClick: () => setReminderOpen(true), show: true },
    {
      label: "مذكرة تحضيرية",
      icon: ScrollText,
      onClick: () => navigate(`/app/assistant?${localCase ? `case=${localCase.id}&` : ""}prompt=${encodeURIComponent("حضّرلي حجج للجلسة القادمة")}`),
      show: true,
    },
    { label: "إنشاء وصل أتعاب", icon: ReceiptText, onClick: () => navigate(`/app/payments?case=${legalCase.id}`), show: legalCase.can.finance },
  ].filter((a) => a.show);

  return (
    <AppShell title={clientNames} subtitle={CASE_TYPE_LABELS[legalCase.type]} backTo="/app/cases">
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <CaseReference value={legalCase.reference} />
          <span className="min-w-0 text-sm text-muted-foreground">{legalCase.court}</span>
          <StatusBadge label={CASE_STATUS_LABELS[legalCase.status]} tone={caseStatusToneOf(legalCase.status)} />
        </div>

        {/* Mobile quick actions: horizontally scrollable chips inside their own container. */}
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none lg:hidden" role="toolbar" aria-label="إجراءات سريعة">
          <div className="flex w-max gap-2">
            {quickActions.map((a) => (
              <Button key={a.label} variant="outline" size="sm" onClick={a.onClick} className="shrink-0">
                <a.icon className="h-4 w-4 text-gold-deep" />
                {a.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:order-2 lg:col-span-2">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
                <TabsTrigger value="documents">الوثائق</TabsTrigger>
                <TabsTrigger value="hearings">الجلسات</TabsTrigger>
                <TabsTrigger value="tasks">
                  المهام
                  {openTasks > 0 && <span className="rounded-sm bg-gold/15 px-1.5 text-xs text-gold-deep">{openTasks}</span>}
                </TabsTrigger>
                {legalCase.can.finance && <TabsTrigger value="fees">الأتعاب</TabsTrigger>}
                <TabsTrigger value="notes">الملاحظات</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>ملخص القضية</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-legal text-sm leading-7 text-foreground/90">{legalCase.description || "لا يوجد وصف مسجّل."}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>السجل الزمني</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {timeline.isPending ? (
                      <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
                    ) : timeline.error ? (
                      <p className="text-sm text-alert">{timeline.error.message}</p>
                    ) : !timeline.data?.length ? (
                      <p className="text-sm text-muted-foreground">لا توجد نشاطات مسجلة بعد.</p>
                    ) : (
                      <ol className="space-y-5">
                        {timeline.data.map((event) => {
                          const Icon = timelineIcons[iconFor(event.resourceType)];
                          return (
                            <li key={event.id} className="relative flex gap-3 sm:gap-4">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
                                <Icon className="h-4 w-4 text-gold-deep" aria-hidden="true" />
                              </div>
                              <div className="min-w-0 flex-1 border-r border-border pb-1 pr-3 sm:pr-4">
                                <p className="font-mono text-xs text-muted-foreground">{formatArabicDate(event.at)}</p>
                                <p className="break-anywhere text-sm font-medium">{event.summary}</p>
                                {event.actor && <p className="text-xs text-muted-foreground">{event.actor.name}</p>}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="documents">
                {documents.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="لا توجد وثائق"
                    description={localCase ? "لم يتم رفع أي وثيقة لهذه القضية بعد." : "وحدة الأرشفة ما زالت تعمل محلياً في هذا المتصفح، ولا يوجد فيها ملف بنفس المرجع."}
                  />
                ) : compact ? (
                  <ul className="space-y-3">
                    {documents.map((doc) => (
                      <li key={doc.id}>
                        <Link
                          to={`/app/document/${doc.id}`}
                          className="card-elevated flex items-center gap-3 p-4 active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <FileText className="h-8 w-8 shrink-0 text-gold-deep" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{doc.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.docType} • <span className="font-mono">{formatArabicDate(doc.date)}</span> • {doc.pages.length} ص
                            </p>
                            {doc.externalOrigin && <p className="mt-1 text-[11px] text-alert">وثيقة واردة من خارج المكتب</p>}
                          </div>
                          <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="card-elevated">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الوثيقة</TableHead>
                          <TableHead>النوع</TableHead>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>الحجم</TableHead>
                          <TableHead>الإجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {documents.map((doc) => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium">
                              {doc.title}
                              {doc.externalOrigin && <span className="mr-2 text-[11px] text-alert">(واردة)</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{doc.docType}</TableCell>
                            <TableCell className="font-mono text-xs">{formatArabicDate(doc.date)}</TableCell>
                            <TableCell className="font-mono text-xs">{doc.size}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" onClick={() => navigate(`/app/document/${doc.id}`)}>
                                فتح
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="hearings" className="space-y-4">
                {legalCase.can.scheduleHearing && legalCase.status !== "CLOSED" && (
                  <div className="flex justify-end">
                    <Button onClick={() => setHearingDialogOpen(true)} className="w-full sm:w-auto">
                      <CalendarPlus className="h-4 w-4" />
                      تحديد جلسة
                    </Button>
                  </div>
                )}
                {hearings.isPending ? (
                  <SkeletonCards count={2} />
                ) : hearings.error ? (
                  <p className="text-sm text-alert">{hearings.error.message}</p>
                ) : !hearings.data?.items.length ? (
                  <EmptyState icon={CalendarIcon} title="لا توجد جلسات" description="لم يتم تحديد أي جلسة لهذه القضية بعد." />
                ) : (
                  <ul className="space-y-3">
                    {hearings.data.items.map((h) => {
                      const urgency = urgencyOf(h.date);
                      return (
                        <li key={h.id} className={cn("card-elevated flex flex-wrap items-center justify-between gap-3 p-4", h.status !== "SCHEDULED" && "opacity-75")}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{h.type}</p>
                            <p className="text-xs text-muted-foreground">
                              {h.court}
                              {h.room ? ` — ${h.room}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {h.status === "SCHEDULED" ? (
                              <StatusBadge label={urgencyLabelOf(urgency)} tone={urgencyToneOf(urgency)} />
                            ) : (
                              <StatusBadge label={HEARING_STATUS_LABELS[h.status]} tone={h.status === "CANCELLED" ? "alert" : "neutral"} />
                            )}
                            <p className="font-mono text-xs">
                              {formatArabicDate(h.date)} — <span dir="ltr">{h.time}</span>
                            </p>
                            <HearingActions hearing={h} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="tasks" className="space-y-4">
                <div className="flex justify-end">
                  <Button onClick={taskActions.openNew} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4" />
                    مهمة لهذا الملف
                  </Button>
                </div>
                {tasks.isPending ? (
                  <SkeletonCards count={2} />
                ) : caseTasks.length === 0 ? (
                  <EmptyState icon={ListTodo} title="لا توجد مهام" description="أضف مهمة أو تذكيراً مرتبطاً بهذا الملف." />
                ) : (
                  <ul className="space-y-3">
                    {caseTasks.map((t) => (
                      <TaskItem key={t.id} task={t} showCase={false} onToggle={taskActions.toggle} onEdit={taskActions.openEdit} onDelete={taskActions.setDeleting} />
                    ))}
                  </ul>
                )}
              </TabsContent>

              {legalCase.can.finance && (
                <TabsContent value="fees">
                  <Card>
                    <CardHeader>
                      <CardTitle>ملخص الأتعاب</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {fees.isPending ? (
                        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
                      ) : !feeSummary ? (
                        <div className="space-y-3 text-sm">
                          <p className="text-muted-foreground">لا يوجد اتفاق أتعاب مسجّل لهذا الملف.</p>
                          <Button variant="outline" size="sm" onClick={() => navigate(`/app/payments?case=${legalCase.id}`)}>
                            إضافة اتفاق أتعاب
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 gap-4 text-center xs:grid-cols-3">
                            <div>
                              <p className="font-mono text-lg">{formatMoney(feeSummary.agreed, feeSummary.currency)}</p>
                              <p className="text-xs text-muted-foreground">المبلغ المتفق عليه</p>
                            </div>
                            <div>
                              <p className="font-mono text-lg text-success">{formatMoney(feeSummary.paid, feeSummary.currency)}</p>
                              <p className="text-xs text-muted-foreground">المدفوع</p>
                            </div>
                            <div>
                              <p className="font-mono text-lg text-alert">{formatMoney(feeSummary.remaining, feeSummary.currency)}</p>
                              <p className="text-xs text-muted-foreground">المتبقي</p>
                            </div>
                          </div>
                          <Progress value={percentOf(feeSummary.paid, feeSummary.agreed)} aria-label="نسبة الاستخلاص" />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusBadge label={SETTLEMENT_LABELS[feeSummary.settlement]} tone={settlementTone(feeSummary.settlement)} />
                            {feeSummary.last && <p className="text-sm text-muted-foreground">آخر دفعة بتاريخ {formatArabicDate(feeSummary.last)}.</p>}
                          </div>
                          {feeSummary.mixed && <p className="text-xs text-muted-foreground">توجد اتفاقيات بعملات أخرى: راجع صفحة الأتعاب.</p>}
                          <Button variant="outline" size="sm" onClick={() => navigate(`/app/payments?case=${legalCase.id}`)}>
                            تفاصيل الدفعات والوصولات
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              <TabsContent value="notes" className="space-y-4">
                {legalCase.can.addNote && (
                  <form onSubmit={noteForm.handleSubmit(onAddNote)} className="card-elevated space-y-3 p-4">
                    <Label htmlFor="note-content">إضافة ملاحظة</Label>
                    <Textarea id="note-content" rows={3} placeholder="اكتب ملاحظتك هنا..." {...noteForm.register("content")} />
                    {noteForm.formState.errors.content && <p className="text-xs text-destructive">{noteForm.formState.errors.content.message}</p>}
                    <Button type="submit" size="sm" disabled={addNote.isPending}>
                      {addNote.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      حفظ الملاحظة
                    </Button>
                  </form>
                )}
                <div className="space-y-3">
                  {notes.isPending && <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>}
                  {notes.data?.length === 0 && <p className="text-sm text-muted-foreground">لا توجد ملاحظات بعد.</p>}
                  {notes.data?.map((note) => (
                    <div key={note.id} className="card-elevated p-4">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{formatArabicDate(note.createdAt)}</span>
                        <span className="text-xs text-muted-foreground">{note.author.name}</span>
                      </div>
                      <p className="break-anywhere whitespace-pre-line text-sm">{note.content}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6 lg:order-1">
            <Card className="hidden lg:block">
              <CardHeader>
                <CardTitle>إجراءات سريعة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {quickActions.map((a) => (
                  <Button key={a.label} variant="outline" className="w-full justify-start" onClick={a.onClick}>
                    <a.icon className="h-4 w-4" />
                    {a.label}
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>معلومات القضية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["الحريف", clientNames],
                  ["المحكمة", legalCase.court],
                  ["المحامي المكلّف", legalCase.assignedLawyer.name],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="flex justify-between gap-4">
                      <span className="shrink-0 text-muted-foreground">{label}</span>
                      <span className="min-w-0 text-left font-medium">{value}</span>
                    </div>
                    <Separator className="mt-3" />
                  </div>
                ))}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">تاريخ فتح الملف</span>
                  <span className="font-mono">{formatArabicDate(legalCase.openedOn)}</span>
                </div>
                <Separator />
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">عدد الوثائق</span>
                  <span className="font-mono">{localCase ? documents.length : "—"}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">الحالة</span>
                  {legalCase.can.changeStatus ? (
                    <Select
                      value={legalCase.status}
                      onValueChange={(v) =>
                        changeStatus.mutate(v as CaseStatus, {
                          onSuccess: () => toast.success("تم تحديث حالة الملف"),
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      <SelectTrigger className="h-9 w-32" aria-label="حالة القضية">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CASE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {CASE_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusBadge label={CASE_STATUS_LABELS[legalCase.status]} tone={caseStatusToneOf(legalCase.status)} />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Floating entry point to the assistant (demo module), scoped to the matching demo file when one exists. */}
      <Link
        to={localCase ? `/app/assistant?case=${localCase.id}` : "/app/assistant"}
        aria-label={`اسأل المساعد عن ملف ${clientNames}`}
        className={cn(
          "no-print fixed left-4 z-30 flex h-14 items-center gap-2 rounded-full border border-gold/50 bg-night px-4 text-sm font-medium text-cream shadow-gold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-95",
          "bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+1rem)] lg:bottom-6 lg:left-6",
        )}
      >
        <Sparkles className="h-5 w-5 text-gold" aria-hidden="true" />
        <span className="hidden xs:inline">اسأل المساعد</span>
      </Link>

      <HearingDialog open={hearingDialogOpen} onOpenChange={setHearingDialogOpen} caseId={legalCase.id} />
      <TaskDialog open={reminderOpen} onOpenChange={setReminderOpen} defaults={reminderDefaults} />
      <TaskDialog open={taskActions.dialogOpen} onOpenChange={taskActions.setDialogOpen} task={taskActions.editing} defaults={{ caseId: legalCase.id }} />
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
