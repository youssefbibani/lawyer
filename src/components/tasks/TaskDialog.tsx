import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RECURRENCE_LABELS, priorityLabel } from "@/lib/status";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCases, useMe, useMembers, useTaskConflicts } from "@/backend/queries";
import { fromUiPriority, fromUiRecurrence, toUiPriority, toUiRecurrence } from "@/backend/labels";
import { todayISO } from "@/backend/format";
import type { TaskConflictsDTO, TaskDTO, TaskKind } from "../../../shared/api";

type UiPriority = "high" | "medium" | "low";
type UiRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface TaskDefaults {
  kind?: TaskKind;
  title?: string;
  caseId?: string;
  hearingId?: string;
  dueDate?: string;
  dueTime?: string;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
}

interface Values {
  kind: TaskKind;
  title: string;
  description: string;
  caseId?: string;
  hearingId?: string;
  assigneeId: string;
  dueDate: string;
  dueTime: string;
  priority: UiPriority;
  recurrence: UiRecurrence;
  notifyInApp: boolean;
  notifyEmail: boolean;
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: TaskDTO;
  defaults?: TaskDefaults;
  onSaved?: (task: TaskDTO) => void;
}

const NO_CASE = "__none__";

function initialValues(task: TaskDTO | undefined, defaults: TaskDefaults | undefined, userId: string): Values {
  if (task) {
    return {
      kind: task.kind,
      title: task.title,
      description: task.description ?? "",
      caseId: task.case?.id,
      hearingId: task.hearingId ?? undefined,
      assigneeId: task.assignee.userId,
      dueDate: task.dueDate ?? "",
      dueTime: task.dueTime ?? "",
      priority: toUiPriority(task.priority),
      recurrence: toUiRecurrence(task.recurrence),
      notifyInApp: task.notifyInApp,
      notifyEmail: task.notifyEmail,
    };
  }
  return {
    kind: defaults?.kind ?? "TASK",
    title: defaults?.title ?? "",
    description: "",
    caseId: defaults?.caseId,
    hearingId: defaults?.hearingId,
    assigneeId: userId,
    dueDate: defaults?.dueDate ?? todayISO(),
    dueTime: defaults?.dueTime ?? "",
    priority: "medium",
    recurrence: "none",
    notifyInApp: defaults?.notifyInApp ?? true,
    notifyEmail: defaults?.notifyEmail ?? false,
  };
}

export function TaskDialog({ open, onOpenChange, task, defaults, onSaved }: TaskDialogProps) {
  const { data: me } = useMe();
  const members = useMembers();
  const cases = useCases({ pageSize: 100, sort: "updatedAt:desc" }, open);
  const [values, setValues] = useState<Values>(() => initialValues(task, defaults, me?.user.id ?? ""));
  const [error, setError] = useState<string>();
  const [ack, setAck] = useState(false);
  const [serverConflicts, setServerConflicts] = useState<TaskConflictsDTO>();

  useEffect(() => {
    if (open) {
      setValues(initialValues(task, defaults, me?.user.id ?? ""));
      setError(undefined);
      setAck(false);
      setServerConflicts(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const preview = useTaskConflicts({ assigneeId: values.assigneeId, dueDate: values.dueDate || undefined, dueTime: values.dueTime || undefined, excludeId: task?.id });
  const conflicts = serverConflicts ?? preview.data;
  const conflictCount = (conflicts?.tasks.length ?? 0) + (conflicts?.hearings.length ?? 0);
  const mailConfigured = !!me?.mail.configured;

  const caseOptions = useMemo(() => {
    const list = (cases.data?.items ?? []).map((c) => ({ id: c.id, label: `${c.clients[0]?.fullName ?? "—"} — ${c.reference}` }));
    if (task?.case && !list.some((c) => c.id === task.case!.id)) list.unshift({ id: task.case.id, label: `${task.case.clientName} — ${task.case.reference}` });
    return list;
  }, [cases.data, task]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setServerConflicts(undefined);
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useApiMutation((body: Record<string, unknown>) => (task ? api.patch<TaskDTO>(`/tasks/${task.id}`, body) : api.post<TaskDTO>("/tasks", body)), ["tasks"]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.title.trim()) return setError("يرجى إدخال عنوان المهمة");
    if (values.dueTime && !values.dueDate) return setError("حدّد التاريخ قبل الساعة");
    if (conflictCount && !ack) return setError("يوجد تعارض في التوقيت: أكّد المتابعة رغم التعارض أو غيّر الموعد.");
    setError(undefined);
    const body = {
      ...(task ? { version: task.version } : {}),
      kind: values.kind,
      title: values.title.trim(),
      description: values.description.trim() || null,
      caseId: values.caseId ?? null,
      hearingId: values.hearingId ?? null,
      assigneeId: values.assigneeId,
      dueDate: values.dueDate || null,
      dueTime: values.dueTime || null,
      priority: fromUiPriority(values.priority),
      recurrence: fromUiRecurrence(values.recurrence),
      notifyInApp: values.notifyInApp,
      notifyEmail: values.notifyEmail && mailConfigured,
      acknowledgeConflicts: ack,
    };
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.success(task ? "تم تحديث المهمة" : values.kind === "REMINDER" ? "تم حفظ التذكير" : "تم حفظ المهمة");
        onSaved?.(saved);
        onOpenChange(false);
      },
      onError: (err) => {
        if (isApiError(err, "TASK_CONFLICT")) setServerConflicts(err.data as TaskConflictsDTO);
        setError(err.message);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? "تعديل المهمة" : "مهمة أو تذكير جديد"}</DialogTitle>
          <DialogDescription>تُربط المهام بالقضية ويُحدَّث سجلها الزمني تلقائياً.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="النوع">
            {(["TASK", "REMINDER"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={values.kind === kind}
                onClick={() => set("kind", kind)}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  values.kind === kind ? "border-gold bg-gold/15 text-gold-deep" : "border-border text-muted-foreground",
                )}
              >
                {kind === "TASK" ? <CheckSquare className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {kind === "TASK" ? "مهمة" : "تذكير"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-title">العنوان</Label>
            <Input id="task-title" value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="مثال: طلب شهادة ملكية محيّنة" enterKeyHint="next" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">تفاصيل (اختياري)</Label>
            <Textarea id="task-desc" rows={2} value={values.description} onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>القضية المرتبطة</Label>
              <Select value={values.caseId || NO_CASE} onValueChange={(v) => setValues((s) => ({ ...s, caseId: v === NO_CASE ? undefined : v, hearingId: v === s.caseId ? s.hearingId : undefined }))}>
                <SelectTrigger aria-label="القضية المرتبطة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CASE}>بدون قضية</SelectItem>
                  {caseOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المكلّف</Label>
              <Select value={values.assigneeId} onValueChange={(v) => set("assigneeId", v)}>
                <SelectTrigger aria-label="المكلّف">
                  <SelectValue placeholder={members.isPending ? "جارٍ التحميل..." : "اختر"} />
                </SelectTrigger>
                <SelectContent>
                  {(members.data ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-date">التاريخ</Label>
              <Input id="task-date" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-time">الساعة (اختياري)</Label>
              <Input id="task-time" type="time" value={values.dueTime} onChange={(e) => set("dueTime", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الأولوية</Label>
              <Select value={values.priority} onValueChange={(v) => set("priority", v as UiPriority)}>
                <SelectTrigger aria-label="الأولوية">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["high", "medium", "low"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {priorityLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>التكرار</Label>
              <Select value={values.recurrence} onValueChange={(v) => set("recurrence", v as UiRecurrence)}>
                <SelectTrigger aria-label="التكرار">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RECURRENCE_LABELS) as UiRecurrence[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {RECURRENCE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-3 rounded-[var(--radius)] border border-border p-3">
            <legend className="px-1 text-sm font-medium">قنوات التذكير</legend>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="ch-app" className="font-normal">
                داخل التطبيق
                <span className="block text-xs text-muted-foreground">يرسله الخادم عند حلول الموعد ويظهر في الإشعارات (يتطلب تحديد الساعة).</span>
              </Label>
              <Switch id="ch-app" checked={values.notifyInApp} onCheckedChange={(v) => set("notifyInApp", v)} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="ch-mail" className="font-normal">
                البريد الإلكتروني
                <span className="block text-xs text-muted-foreground">
                  {mailConfigured ? "يُرسل عبر خدمة البريد المهيأة على الخادم." : "غير متاح: خدمة البريد غير مهيأة على الخادم."}
                </span>
              </Label>
              <Switch id="ch-mail" checked={values.notifyEmail && mailConfigured} disabled={!mailConfigured} onCheckedChange={(v) => set("notifyEmail", v)} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="ch-sms" className="font-normal">
                SMS
                <span className="block text-xs text-muted-foreground">غير متاح: لا يوجد مزوّد رسائل قصيرة مرتبط.</span>
              </Label>
              <Switch id="ch-sms" checked={false} disabled />
            </div>
          </fieldset>

          {conflictCount > 0 && (
            <div role="alert" className="space-y-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                تعارض في التوقيت
              </p>
              <ul className="list-inside list-disc space-y-1 text-xs">
                {conflicts?.hearings.map((h) => (
                  <li key={h.id}>
                    {h.type} — {h.clientName} على الساعة {h.time}
                  </li>
                ))}
                {conflicts?.tasks.map((t) => (
                  <li key={t.id}>
                    مهمة أخرى للمكلّف نفسه: «{t.title}» ({t.dueTime})
                  </li>
                ))}
              </ul>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-foreground">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                <span className="text-xs">أؤكد الحفظ رغم التعارض</span>
              </label>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {task ? "حفظ التعديلات" : "حفظ"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
