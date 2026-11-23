import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellRing, Check, CheckSquare, Flame, Loader2, Mail, Plus, Repeat, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/shared/DateField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RECURRENCE_LABELS } from "@/lib/status";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCases, useMe, useMembers, useTaskConflicts } from "@/backend/queries";
import { fromUiPriority, fromUiRecurrence, toUiPriority, toUiRecurrence } from "@/backend/labels";
import { todayISO } from "@/backend/format";
import { formatArabicDate } from "@/lib/formatters";
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

const chip = "inline-flex h-11 items-center rounded-[var(--radius)] border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipOn = "border-gold bg-gold/15 text-gold-deep";
const chipOff = "border-border bg-background text-foreground hover:border-gold/50 hover:bg-gold/5";

/** The two kinds, each with a one-line explanation in plain words. */
const KINDS = [
  { kind: "TASK", icon: CheckSquare, label: "مهمة", hint: "عمل يجب إنجازه، وتُعلّمه عند الانتهاء" },
  { kind: "REMINDER", icon: Bell, label: "تذكير", hint: "تنبيه فقط في يوم محدّد، دون عمل للإنجاز" },
] as const;

/** One-tap dates: what lawyers say out loud. */
const QUICK_DAYS = [
  { days: 0, label: "اليوم" },
  { days: 1, label: "غداً" },
  { days: 7, label: "بعد أسبوع" },
] as const;

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};

/** «الأستاذة هالة الماجري» → «هالة الماجري». */
const shortName = (name: string) => name.replace(/^(الأستاذة?|الأستاذ)\s+/, "");

/** A numbered question with its answer underneath. */
function Question({ n, label, htmlFor, aside, children }: { n: number; label: string; htmlFor?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-night text-[11px] text-cream" aria-hidden="true">
            {n}
          </span>
          {label}
        </Label>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** A small on/off pill for one reminder channel. */
function ChannelToggle({ id, icon: Icon, label, checked, disabled, hint, onChange }: { id: string; icon: LucideIcon; label: string; checked: boolean; disabled?: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hint ? `${label} — ${hint}` : label}
      title={hint}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 coarse:h-10",
        checked ? "border-gold bg-gold/15 text-gold-deep" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

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
  const [showDetails, setShowDetails] = useState(!!task?.description);
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initialValues(task, defaults, me?.user.id ?? ""));
      setError(undefined);
      setAck(false);
      setServerConflicts(undefined);
      setShowDetails(!!task?.description);
      setShowOptions(!!task && (task.recurrence !== "NONE" || task.notifyEmail || !task.notifyInApp));
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

  // The current user first, then the rest of the office (inactive members only if already assigned).
  const people = useMemo(() => {
    const list = (members.data ?? []).filter((m) => m.active || m.userId === values.assigneeId);
    return [...list.filter((m) => m.userId === me?.user.id), ...list.filter((m) => m.userId !== me?.user.id)];
  }, [members.data, me?.user.id, values.assigneeId]);

  const summary = useMemo(() => {
    if (!values.dueDate) return "بدون تاريخ: لن يصل أي تنبيه. اختر يوماً ليصلك تنبيه.";
    const day = `${weekday(values.dueDate)} ${formatArabicDate(values.dueDate)}`;
    const via = [values.notifyInApp && "في التطبيق", values.notifyEmail && mailConfigured && "بالبريد"].filter(Boolean).join(" و");
    if (!via) return `يوم ${day}، بدون تنبيه.`;
    const assignee = people.find((m) => m.userId === values.assigneeId);
    const who = !assignee || assignee.userId === me?.user.id ? "يصلك تنبيه" : `يصل ${shortName(assignee.name)} تنبيه`;
    const repeat = values.recurrence !== "none" ? `، ويتكرر ${RECURRENCE_LABELS[values.recurrence]}` : "";
    return `${who} ${via} يوم ${day} على الساعة ${values.dueTime || "08:00"}${repeat}.`;
  }, [values, mailConfigured, people, me?.user.id]);

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? "تعديل العمل المطلوب" : "عمل مطلوب جديد"}</DialogTitle>
          <DialogDescription className="sr-only">اختر النوع، ثم أجب عن الأسئلة.</DialogDescription>
        </DialogHeader>
        {/* Task or reminder: two explained cards, centred, so the difference is clear without guessing. */}
        <div className="mx-auto grid w-full max-w-lg grid-cols-2 gap-2" role="radiogroup" aria-label="النوع">
          {KINDS.map(({ kind, icon: Icon, label, hint }) => {
            const on = values.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={label}
                aria-describedby={`kind-hint-${kind}`}
                onClick={() => set("kind", kind)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 rounded-[var(--radius)] border-2 px-3 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-gold bg-gold/10" : "border-border bg-background hover:border-gold/50",
                )}
              >
                {on && <Check className="absolute left-2 top-2 h-4 w-4 text-gold-deep" aria-hidden="true" />}
                <span className={cn("flex items-center gap-1.5 text-sm font-semibold", on ? "text-gold-deep" : "text-foreground")}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </span>
                <span id={`kind-hint-${kind}`} className="text-[11px] leading-4 text-muted-foreground">
                  {hint}
                </span>
              </button>
            );
          })}
        </div>
        {/* Plain questions, one per block, with one-tap answers: made for people who don't like forms. */}
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Question
            n={1}
            label={values.kind === "REMINDER" ? "بماذا نذكّرك؟" : "ماذا يجب فعله؟"}
            htmlFor="task-title"
            aside={
              !showDetails && (
                <button type="button" onClick={() => setShowDetails(true)} className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground coarse:min-h-10">
                  <Plus className="h-3.5 w-3.5" />
                  إضافة تفاصيل
                </button>
              )
            }
          >
            <div className="flex items-center gap-2">
              <Input
                id="task-title"
                aria-label="العنوان"
                value={values.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={values.kind === "REMINDER" ? "مثال: الاتصال بالحريف" : "مثال: طلب شهادة ملكية محيّنة"}
                enterKeyHint="next"
                className="h-11 min-w-0 flex-1 text-base"
              />
              <button
                type="button"
                role="switch"
                aria-checked={values.priority === "high"}
                onClick={() => set("priority", values.priority === "high" ? (task && toUiPriority(task.priority) === "low" ? "low" : "medium") : "high")}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  values.priority === "high" ? "border-alert bg-alert/10 text-alert" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Flame className="h-4 w-4" aria-hidden="true" />
                عاجلة
              </button>
            </div>
            {showDetails && (
              <Textarea id="task-desc" aria-label="تفاصيل" rows={2} autoFocus={!values.description} placeholder="تفاصيل إضافية (اختياري)" value={values.description} onChange={(e) => set("description", e.target.value)} className="min-h-14" />
            )}
          </Question>

          <Question n={2} label="متى؟" htmlFor="task-date">
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_DAYS.map((q) => {
                const iso = inDays(q.days);
                return (
                  <button
                    key={q.days}
                    type="button"
                    aria-pressed={values.dueDate === iso}
                    onClick={() => set("dueDate", iso)}
                    className={cn(chip, values.dueDate === iso ? chipOn : chipOff)}
                  >
                    {q.label}
                  </button>
                );
              })}
              <div className="w-40">
                <DateField
                  id="task-date"
                  aria-label="التاريخ"
                  value={values.dueDate}
                  onChange={(v) => set("dueDate", v)}
                  className={cn(
                    "h-11 rounded-[var(--radius)] border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring",
                    values.dueDate && !QUICK_DAYS.some((q) => inDays(q.days) === values.dueDate) ? "border-gold bg-gold/10" : "border-input",
                  )}
                />
              </div>
            </div>
          </Question>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Question n={3} label="أي قضية؟">
              <Select value={values.caseId || NO_CASE} onValueChange={(v) => setValues((s) => ({ ...s, caseId: v === NO_CASE ? undefined : v, hearingId: v === s.caseId ? s.hearingId : undefined }))}>
                <SelectTrigger aria-label="القضية المرتبطة" className="h-11">
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
            </Question>

            <Question n={4} label="مَن سيقوم بها؟">
              {people.length <= 4 ? (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="المكلّف">
                  {people.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      role="radio"
                      aria-checked={values.assigneeId === m.userId}
                      onClick={() => set("assigneeId", m.userId)}
                      className={cn(chip, values.assigneeId === m.userId ? chipOn : chipOff)}
                    >
                      {m.userId === me?.user.id ? "أنا" : shortName(m.name)}
                    </button>
                  ))}
                </div>
              ) : (
                <Select value={values.assigneeId} onValueChange={(v) => set("assigneeId", v)}>
                  <SelectTrigger aria-label="المكلّف" className="h-11">
                    <SelectValue placeholder={members.isPending ? "جارٍ التحميل..." : "اختر"} />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.userId === me?.user.id ? `أنا (${m.name})` : m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Question>
          </div>

          {/* What will happen, in one plain sentence. Rarely used settings stay folded. */}
          <div className="rounded-[var(--radius)] bg-secondary/60 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="flex min-w-0 flex-1 items-start gap-2">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" aria-hidden="true" />
                <span>{summary}</span>
              </p>
              {!showOptions && (
                <button type="button" onClick={() => setShowOptions(true)} className="ms-6 inline-flex min-h-7 shrink-0 items-center text-xs font-medium text-gold-deep underline-offset-2 hover:underline coarse:min-h-10 sm:ms-0">
                  تغيير التنبيه أو التكرار
                </button>
              )}
            </div>
            {showOptions ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <ChannelToggle id="ch-app" icon={BellRing} label="تنبيه في التطبيق" checked={values.notifyInApp} onChange={(v) => set("notifyInApp", v)} />
                <ChannelToggle
                  id="ch-mail"
                  icon={Mail}
                  label="تنبيه بالبريد"
                  checked={values.notifyEmail && mailConfigured}
                  disabled={!mailConfigured}
                  hint={mailConfigured ? undefined : "غير متاح: خدمة البريد غير مهيأة على الخادم."}
                  onChange={(v) => set("notifyEmail", v)}
                />
                <Select value={values.recurrence} onValueChange={(v) => set("recurrence", v as UiRecurrence)}>
                  <SelectTrigger aria-label="التكرار" className="h-8 w-auto gap-1.5 rounded-full px-3 text-xs coarse:h-10">
                    <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
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
            ) : null}
          </div>

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
              {task ? "حفظ التعديلات" : values.kind === "REMINDER" ? "حفظ التذكير" : "حفظ المهمة"}
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
