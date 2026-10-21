import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarCheck2, ListTodo, Plus, Sparkles } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskItem } from "@/components/tasks/TaskItem";
import { useTaskActions } from "@/components/tasks/useTaskActions";
import { useCases, useMe, useMembers, useTasks, useTaskSummary } from "@/backend/queries";
import { api } from "@/backend/http";
import { todayISO } from "@/backend/format";
import type { TaskBucket, TaskDTO } from "../../shared/api";

const BUCKET_LABELS: Record<TaskBucket, string> = {
  today: "اليوم",
  upcoming: "القادمة",
  overdue: "المتأخرة",
  done: "المنجزة",
};

function bucketOf(task: TaskDTO, today: string): TaskBucket {
  if (task.status === "DONE") return "done";
  if (task.dueDate && task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return "upcoming";
}

export default function Tasks() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus") ?? undefined;
  const actions = useTaskActions();
  const [assignee, setAssignee] = useState<string>("all");
  const [caseFilter, setCaseFilter] = useState<string>("all");
  const [tab, setTab] = useState<TaskBucket>("today");
  const members = useMembers();
  const cases = useCases({ pageSize: 100, sort: "updatedAt:desc" });

  const filters = { assigneeId: assignee === "all" ? undefined : assignee, caseId: caseFilter === "all" ? undefined : caseFilter };
  const summary = useTaskSummary(filters);
  const tasks = useTasks({ ...filters, bucket: tab });

  // Deep link (/app/tasks?focus=<id>): open the tab that contains the task.
  useEffect(() => {
    if (!focus) return;
    let cancelled = false;
    api
      .get<TaskDTO>(`/tasks/${focus}`)
      .then((t) => !cancelled && setTab(bucketOf(t, todayISO())))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [focus]);

  // Default to the overdue tab when nothing is due today.
  useEffect(() => {
    if (!focus && summary.data && summary.data.today === 0 && summary.data.overdue > 0) setTab("overdue");
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.data === undefined]);

  useEffect(() => {
    if (!focus || !tasks.data) return;
    document.getElementById(`task-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, tasks.data]);

  const list = tasks.data?.items ?? [];

  return (
    <AppShell title="المهام والتذكيرات" subtitle="متابعة أعمال المكتب والآجال">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
            <div className="min-w-0 sm:w-48">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger aria-label="تصفية حسب المكلّف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفريق</SelectItem>
                  {(members.data ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.userId === me?.user.id ? `مهامي (${m.name})` : m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 sm:w-56">
              <Select value={caseFilter} onValueChange={setCaseFilter}>
                <SelectTrigger aria-label="تصفية حسب القضية">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل القضايا</SelectItem>
                  {(cases.data?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.clients[0]?.fullName ?? "—"} — {c.reference}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="hidden gap-2 sm:flex">
            <Button variant="outline" asChild title="المساعد في وضع تجريبي: ما ينشئه يُحفظ في هذا المتصفح ولا يظهر في هذه القائمة بعد">
              <Link to={`/app/assistant?prompt=${encodeURIComponent("اعمل تذكير باش نكلّم الحريف نهار الجمعة")}`}>
                <Sparkles className="h-4 w-4 text-gold-deep" />
                عبر المساعد
              </Link>
            </Button>
            <Button onClick={actions.openNew}>
              <Plus className="h-4 w-4" />
              مهمة جديدة
            </Button>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TaskBucket);
            if (focus) setParams({}, { replace: true });
          }}
        >
          <TabsList>
            {(Object.keys(BUCKET_LABELS) as TaskBucket[]).map((b) => (
              <TabsTrigger key={b} value={b}>
                {BUCKET_LABELS[b]}
                <span
                  className={
                    b === "overdue" && summary.data?.overdue ? "rounded-sm bg-alert/15 px-1.5 text-xs text-alert" : "rounded-sm bg-muted px-1.5 text-xs text-muted-foreground"
                  }
                >
                  {summary.data?.[b] ?? "…"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(BUCKET_LABELS) as TaskBucket[]).map((b) => (
            <TabsContent key={b} value={b}>
              {tasks.isPending ? (
                <SkeletonCards count={2} />
              ) : tasks.error ? (
                <div role="alert" className="card-elevated space-y-3 p-6 text-center">
                  <p className="text-sm text-alert">{tasks.error.message}</p>
                  <Button variant="outline" onClick={() => void tasks.refetch()}>
                    إعادة المحاولة
                  </Button>
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  icon={b === "done" ? CalendarCheck2 : ListTodo}
                  title={b === "overdue" ? "لا توجد مهام متأخرة" : b === "done" ? "لا توجد مهام منجزة بعد" : "لا توجد مهام هنا"}
                  description={b === "today" ? "أضف مهمة يدوياً أو اطلب من المساعد إنشاء تذكير." : undefined}
                />
              ) : (
                <ul className="space-y-3">
                  {list.map((t) => (
                    <TaskItem key={t.id} task={t} highlighted={t.id === focus} onToggle={actions.toggle} onEdit={actions.openEdit} onDelete={actions.setDeleting} />
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Button
        variant="gold"
        size="icon"
        aria-label="مهمة جديدة"
        onClick={actions.openNew}
        className="fixed bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+1rem)] left-4 z-30 h-14 w-14 rounded-full shadow-lg sm:hidden coarse:h-14 coarse:w-14"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <TaskDialog open={actions.dialogOpen} onOpenChange={actions.setDialogOpen} task={actions.editing} />
      <ConfirmDialog
        open={!!actions.deleting}
        onOpenChange={(o) => !o && actions.setDeleting(undefined)}
        title="حذف المهمة"
        description={`سيتم حذف «${actions.deleting?.title ?? ""}» من القوائم (يبقى أثرها في سجل العمليات).`}
        confirmLabel="حذف"
        tone="destructive"
        onConfirm={actions.confirmDelete}
      />
    </AppShell>
  );
}
