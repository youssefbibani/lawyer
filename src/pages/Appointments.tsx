import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck2, CalendarPlus, Check, Loader2, Pencil, Users, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatRelativeDay } from "@/lib/formatters";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useAppointments, useCan, useClients } from "@/backend/queries";
import { todayISO } from "@/backend/format";
import type { AppointmentDTO, AppointmentStatus } from "../../shared/api";

const STATUS: Record<AppointmentStatus, { label: string; tone: "gold" | "success" | "neutral" }> = {
  SCHEDULED: { label: "مبرمج", tone: "gold" },
  DONE: { label: "تمّ", tone: "success" },
  CANCELLED: { label: "أُلغي", tone: "neutral" },
};

type When = "upcoming" | "past";

/** «مواعيد الحرفاء»: meetings with clients at the office. */
export default function Appointments() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [when, setWhen] = useState<When>("upcoming");
  const [editing, setEditing] = useState<AppointmentDTO | "new" | null>(null);
  const list = useAppointments({ when });
  const items = list.data?.items ?? [];
  const canWrite = can("client:write");

  // Deep links: /app/appointments?new=1 opens the form, &client=<id> preselects the client.
  const opening = params.get("new") !== null;
  const newFor = params.get("client") ?? undefined;
  useEffect(() => {
    if (opening && canWrite) setEditing("new");
  }, [opening, canWrite]);

  const setStatus = useApiMutation((v: { a: AppointmentDTO; status: AppointmentStatus }) => api.patch<AppointmentDTO>(`/appointments/${v.a.id}`, { status: v.status, version: v.a.version }), ["appointments"]);

  function mark(a: AppointmentDTO, status: AppointmentStatus) {
    setStatus.mutate(
      { a, status },
      { onSuccess: () => toast.success(status === "DONE" ? "تم تسجيل الموعد كمنجز" : "تم إلغاء الموعد"), onError: (err) => toast.error(err.message) },
    );
  }

  return (
    <AppShell title="مواعيد الحرفاء" subtitle="مواعيد المكتب مع الحرفاء">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={when} onValueChange={(v) => setWhen(v as When)}>
            <TabsList>
              <TabsTrigger value="upcoming">القادمة</TabsTrigger>
              <TabsTrigger value="past">السابقة</TabsTrigger>
            </TabsList>
          </Tabs>
          {canWrite && (
            <Button onClick={() => setEditing("new")}>
              <CalendarPlus className="h-4 w-4" />
              موعد جديد
            </Button>
          )}
        </div>

        {list.isPending ? (
          <SkeletonCards count={2} />
        ) : list.error ? (
          <div role="alert" className="card-elevated space-y-3 p-6 text-center">
            <p className="text-sm text-alert">{list.error.message}</p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={when === "upcoming" ? CalendarPlus : CalendarCheck2}
            title={when === "upcoming" ? "لا توجد مواعيد قادمة" : "لا توجد مواعيد سابقة"}
            description={when === "upcoming" && canWrite ? "أضف موعداً مع حريف بالضغط على «موعد جديد»." : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className={cn("card-elevated flex flex-wrap items-center gap-3 p-4", a.status !== "SCHEDULED" && "opacity-75")}>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.client.fullName}</span>
                    <StatusBadge label={STATUS[a.status].label} tone={STATUS[a.status].tone} />
                  </div>
                  <p className="text-sm">{a.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeDay(a.date)}
                    {a.time && (
                      <span className="font-mono" dir="ltr">
                        {" "}
                        {a.time}
                      </span>
                    )}
                  </p>
                  {a.notes && <p className="whitespace-pre-line text-xs text-muted-foreground">{a.notes}</p>}
                </div>
                {canWrite && a.status === "SCHEDULED" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => mark(a, "DONE")} disabled={setStatus.isPending}>
                      <Check className="h-4 w-4 text-success" />
                      تمّ
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                      <Pencil className="h-4 w-4" />
                      تعديل
                    </Button>
                    <Button size="sm" variant="ghost" className="text-alert" onClick={() => mark(a, "CANCELLED")} disabled={setStatus.isPending}>
                      <X className="h-4 w-4" />
                      إلغاء
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AppointmentDialog
        appointment={editing}
        defaultClientId={newFor}
        onClose={() => {
          setEditing(null);
          if (opening) setParams({}, { replace: true });
        }}
      />
    </AppShell>
  );
}

interface Form {
  clientId: string;
  date: string;
  time: string;
  subject: string;
  notes: string;
}

function AppointmentDialog({ appointment, defaultClientId, onClose }: { appointment: AppointmentDTO | "new" | null; defaultClientId?: string; onClose: () => void }) {
  const existing = appointment && appointment !== "new" ? appointment : null;
  const clients = useClients({ pageSize: 100, sort: "fullName:asc" }, !!appointment);
  const [form, setForm] = useState<Form>({ clientId: "", date: todayISO(), time: "", subject: "", notes: "" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!appointment) return;
    setError(undefined);
    setForm(
      existing
        ? { clientId: existing.client.id, date: existing.date, time: existing.time ?? "", subject: existing.subject, notes: existing.notes ?? "" }
        : { clientId: defaultClientId ?? "", date: todayISO(), time: "", subject: "", notes: "" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment]);

  const save = useApiMutation(
    (body: Record<string, unknown>) => (existing ? api.patch<AppointmentDTO>(`/appointments/${existing.id}`, { ...body, version: existing.version }) : api.post<AppointmentDTO>("/appointments", body)),
    ["appointments"],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientId) return setError("يرجى اختيار الحريف");
    if (!form.date) return setError("يرجى تحديد التاريخ");
    if (!form.subject.trim()) return setError("يرجى إدخال موضوع الموعد");
    setError(undefined);
    save.mutate(
      { clientId: form.clientId, date: form.date, time: form.time || null, subject: form.subject.trim(), notes: form.notes },
      {
        onSuccess: () => (toast.success(existing ? "تم تعديل الموعد" : "تم حفظ الموعد"), onClose()),
        onError: (err) => setError(isApiError(err) && err.details[0] ? err.details.map((d) => d.message).join(" — ") : err.message),
      },
    );
  }

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const options = clients.data?.items ?? [];

  return (
    <Dialog open={!!appointment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "تعديل الموعد" : "موعد جديد مع حريف"}</DialogTitle>
          <DialogDescription>موعد بالمكتب مع أحد الحرفاء.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label>الحريف</Label>
            <Select value={form.clientId} onValueChange={(v) => set("clientId", v)}>
              <SelectTrigger aria-label="الحريف">
                <SelectValue placeholder={clients.isPending ? "جارٍ التحميل..." : "اختر الحريف"} />
              </SelectTrigger>
              <SelectContent>
                {options.length === 0 && !clients.isPending ? (
                  <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                    <Users className="h-4 w-4" />
                    لا يوجد حرفاء بعد
                  </div>
                ) : (
                  options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apt-subject">الموضوع</Label>
            <Input id="apt-subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="مثال: إمضاء التوكيل" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="apt-date">التاريخ</Label>
              <Input id="apt-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apt-time">الساعة (اختياري)</Label>
              <Input id="apt-time" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apt-notes">ملاحظات (اختياري)</Label>
            <Textarea id="apt-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
