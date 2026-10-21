import { useState } from "react";
import { History, KeyRound, Loader2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, isApiError } from "@/backend/http";
import { PASSWORD_MIN } from "@/backend/auth";
import { useApiMutation, useAudit, useCan, useMe, useOfficeMembers } from "@/backend/queries";
import { ROLE_LABELS_AR } from "@/backend/labels";
import { ROLES, type MemberDTO, type Role } from "../../../shared/api";

const errorText = (err: unknown) => (isApiError(err) && err.details.length ? err.details.map((d) => d.message).join(" — ") : (err as Error).message);

export function MembersCard() {
  const can = useCan();
  const { data: me } = useMe();
  const enabled = can("members:manage");
  const members = useOfficeMembers(enabled);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "clerk" as Role, password: "" });
  const [formError, setFormError] = useState<string>();
  const [resetFor, setResetFor] = useState<MemberDTO | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const create = useApiMutation((body: typeof form) => api.post<MemberDTO>("/settings/members", body), ["settings"]);
  const changeRole = useApiMutation(({ userId, role }: { userId: string; role: Role }) => api.patch<MemberDTO>(`/settings/members/${userId}`, { role }), ["settings"]);
  const setActive = useApiMutation(({ userId, active }: { userId: string; active: boolean }) => api.post<MemberDTO>(`/settings/members/${userId}/${active ? "reactivate" : "deactivate"}`), ["settings"]);
  const resetPassword = useApiMutation(({ userId, password }: { userId: string; password: string }) => api.post(`/settings/members/${userId}/password`, { password }), ["settings"]);

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gold-deep" aria-hidden="true" />
            أعضاء المكتب
          </CardTitle>
          <CardDescription>الأدوار والصلاحيات الفعلية على الخادم. لا يُحذف أي عضو: يُعطَّل ويبقى أثره في السجل.</CardDescription>
        </div>
        <Button size="sm" onClick={() => (setForm({ name: "", email: "", role: "clerk", password: "" }), setFormError(undefined), setAdding(true))}>
          <UserPlus className="h-4 w-4" />
          إضافة عضو
        </Button>
      </CardHeader>
      <CardContent>
        {members.isPending ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : members.error ? (
          <p className="text-sm text-alert">{members.error.message}</p>
        ) : (
          <ul className="divide-y divide-border">
            {members.data?.map((m) => {
              const self = m.userId === me?.user.id;
              return (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {m.name} {self && <span className="text-xs text-muted-foreground">(أنت)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {m.email}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!m.active && <StatusBadge label="معطّل" tone="alert" />}
                    <Select
                      value={m.role}
                      disabled={self || !m.active || changeRole.isPending}
                      onValueChange={(role) =>
                        changeRole.mutate({ userId: m.userId, role: role as Role }, { onSuccess: () => toast.success("تم تغيير الدور"), onError: (err) => toast.error(errorText(err)) })
                      }
                    >
                      <SelectTrigger className="h-9 w-36" aria-label={`دور ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS_AR[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!self && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => (setNewPassword(""), setResetFor(m))} aria-label={`تعيين كلمة مرور لـ${m.name}`}>
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant={m.active ? "ghost" : "outline"}
                          className={m.active ? "text-alert" : undefined}
                          disabled={setActive.isPending}
                          onClick={() =>
                            setActive.mutate(
                              { userId: m.userId, active: !m.active },
                              { onSuccess: () => toast.success(m.active ? "تم تعطيل العضو وإنهاء جلساته" : "أُعيد تفعيل العضو"), onError: (err) => toast.error(errorText(err)) },
                            )
                          }
                        >
                          {m.active ? "تعطيل" : "إعادة تفعيل"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة عضو</DialogTitle>
            <DialogDescription>أنشئ حساباً بكلمة مرور أولية وسلّمها للعضو بوسيلة آمنة؛ يمكنه تغييرها من إعداداته.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (form.password.length < PASSWORD_MIN) return setFormError(`كلمة المرور يجب أن تحتوي على ${PASSWORD_MIN} أحرف على الأقل.`);
              create.mutate(form, { onSuccess: () => (toast.success("تمت إضافة العضو"), setAdding(false)), onError: (err) => setFormError(errorText(err)) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="m-name">الاسم الكامل</Label>
              <Input id="m-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-email">البريد الإلكتروني</Label>
              <Input id="m-email" type="email" dir="ltr" className="text-left" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الدور</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}>
                  <SelectTrigger aria-label="الدور">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS_AR[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-password">كلمة مرور أولية</Label>
                <Input id="m-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              </div>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                إضافة
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعيين كلمة مرور جديدة</DialogTitle>
            <DialogDescription>{resetFor?.name} — ستُنهى كل جلساته الحالية.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-pw">كلمة المرور الجديدة</Label>
            <Input id="reset-pw" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              disabled={newPassword.length < PASSWORD_MIN || resetPassword.isPending}
              onClick={() =>
                resetFor &&
                resetPassword.mutate(
                  { userId: resetFor.userId, password: newPassword },
                  { onSuccess: () => (toast.success("تم تعيين كلمة المرور"), setResetFor(null)), onError: (err) => toast.error(errorText(err)) },
                )
              }
            >
              {resetPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ
            </Button>
            <Button variant="outline" onClick={() => setResetFor(null)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function ServerAuditCard() {
  const can = useCan();
  const enabled = can("audit:read");
  const [page, setPage] = useState(1);
  const audit = useAudit({ page, pageSize: 25 }, enabled);
  if (!enabled) return null;
  const pages = Math.max(1, Math.ceil((audit.data?.total ?? 0) / 25));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-gold-deep" aria-hidden="true" />
          سجل عمليات الخادم
        </CardTitle>
        <CardDescription>سجل غير قابل للتعديل أو الحذف لكل عملية على بيانات المكتب، بما فيها المحاولات المرفوضة.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit.isPending ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : audit.error ? (
          <p className="text-sm text-alert">{audit.error.message}</p>
        ) : !audit.data?.items.length ? (
          <p className="text-sm text-muted-foreground">لا توجد عمليات مسجّلة بعد.</p>
        ) : (
          <>
            <ul className="divide-y divide-border text-sm">
              {audit.data.items.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    {a.summary ?? a.operation}
                    {a.outcome !== "SUCCESS" && <span className="mr-2 rounded-sm bg-alert/15 px-1.5 text-[11px] text-alert">{a.outcome === "DENIED" ? "مرفوضة" : "فاشلة"}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.actor?.name ?? "—"} • <span className="font-mono">{new Date(a.at).toLocaleString("en-GB")}</span>
                  </span>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  السابق
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page} / {pages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  التالي
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
