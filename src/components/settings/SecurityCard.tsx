import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { copyToClipboard } from "@/lib/print";
import { api } from "@/backend/http";
import { changePassword, confirmTwoFactor, disableTwoFactor, enableTwoFactor, PASSWORD_MIN, revokeOtherSessions } from "@/backend/auth";
import { useApiMutation, useMe, useSessions } from "@/backend/queries";

function describeAgent(ua: string | null): string {
  if (!ua) return "جهاز غير معروف";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  return [browser, os].filter(Boolean).join(" — ");
}

export function SecurityCard() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const sessions = useSessions();
  const [autoLock, setAutoLock] = useLocalStorage("qasr-al-adala:autolock", "15");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "", revoke: true });
  const [pwError, setPwError] = useState<string>();
  const [pwSaving, setPwSaving] = useState(false);
  const [twoFactor, setTwoFactor] = useState<null | { step: "password" | "verify" | "disable"; password: string; totpURI?: string; backupCodes?: string[]; code: string; error?: string; busy?: boolean }>(null);
  const revoke = useApiMutation((id: string) => api.del(`/me/sessions/${id}`), ["settings"]);
  const twoFactorEnabled = !!me?.user.twoFactorEnabled;
  const secret = twoFactor?.totpURI ? new URL(twoFactor.totpURI).searchParams.get("secret") : null;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next.length < PASSWORD_MIN) return setPwError(`كلمة المرور يجب أن تحتوي على ${PASSWORD_MIN} أحرف على الأقل.`);
    if (pw.next !== pw.confirm) return setPwError("كلمتا المرور غير متطابقتين.");
    setPwSaving(true);
    setPwError(undefined);
    try {
      await changePassword(pw.current, pw.next, pw.revoke);
      setPasswordOpen(false);
      setPw({ current: "", next: "", confirm: "", revoke: true });
      toast.success("تم تغيير كلمة المرور", { description: pw.revoke ? "أُنهيت الجلسات على الأجهزة الأخرى." : undefined });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwSaving(false);
    }
  }

  async function twoFactorNext(e: React.FormEvent) {
    e.preventDefault();
    if (!twoFactor) return;
    setTwoFactor({ ...twoFactor, busy: true, error: undefined });
    try {
      if (twoFactor.step === "password") {
        const r = await enableTwoFactor(twoFactor.password);
        setTwoFactor({ ...twoFactor, step: "verify", totpURI: r.totpURI, backupCodes: r.backupCodes, busy: false, password: "" });
      } else if (twoFactor.step === "verify") {
        await confirmTwoFactor(twoFactor.code.trim());
        setTwoFactor(null);
        toast.success("تم تفعيل التحقق بخطوتين");
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      } else {
        await disableTwoFactor(twoFactor.password);
        setTwoFactor(null);
        toast.success("تم تعطيل التحقق بخطوتين");
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    } catch (err) {
      setTwoFactor((t) => (t ? { ...t, busy: false, error: (err as Error).message } : t));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>الأمان</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">تغيير كلمة المرور</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => (setPwError(undefined), setPasswordOpen(true))}>
            تغيير
          </Button>
        </div>
        <Separator />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              المصادقة الثنائية (TOTP)
              <span className="block text-xs text-muted-foreground">{twoFactorEnabled ? "مفعّلة: يُطلب رمز من تطبيق المصادقة عند كل دخول." : "غير مفعّلة."}</span>
            </span>
          </div>
          <Switch checked={twoFactorEnabled} onCheckedChange={(v) => setTwoFactor({ step: v ? "password" : "disable", password: "", code: "" })} aria-label="المصادقة الثنائية" />
        </div>
        <Separator />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            قفل التطبيق بعد فترة خمول
            <span className="block text-xs text-muted-foreground">تفضيل على هذا الجهاز؛ تنتهي الجلسة على الخادم بعد 12 ساعة دون نشاط.</span>
          </span>
          <Select value={autoLock} onValueChange={setAutoLock}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 دقائق</SelectItem>
              <SelectItem value="15">15 دقيقة</SelectItem>
              <SelectItem value="30">30 دقيقة</SelectItem>
              <SelectItem value="never">بدون قفل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              الجلسات النشطة
            </p>
            {(sessions.data?.length ?? 0) > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void revokeOtherSessions()
                    .then(() => (toast.success("أُنهيت كل الجلسات الأخرى"), queryClient.invalidateQueries({ queryKey: ["sessions"] })))
                    .catch((err: Error) => toast.error(err.message))
                }
              >
                إنهاء كل الجلسات الأخرى
              </Button>
            )}
          </div>
          {sessions.isPending && <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>}
          {sessions.error && <p className="text-sm text-alert">{sessions.error.message}</p>}
          {sessions.data?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border p-3 text-sm">
              <span className="text-muted-foreground">
                {describeAgent(s.userAgent)}
                {s.current ? " — هذا الجهاز" : ""}
                <span className="block text-xs">
                  آخر نشاط: <span className="font-mono">{new Date(s.lastActiveAt).toLocaleString("en-GB")}</span>
                  {s.ipAddress && (
                    <>
                      {" "}
                      • <span dir="ltr">{s.ipAddress}</span>
                    </>
                  )}
                </span>
              </span>
              {s.current ? (
                <span className="text-xs text-success">الجلسة الحالية</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success("تم إنهاء الجلسة"), onError: (err) => toast.error(err.message) })}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  إنهاء الجلسة
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغيير كلمة المرور</DialogTitle>
            <DialogDescription>أدخل كلمة المرور الحالية والجديدة ({PASSWORD_MIN} أحرف على الأقل).</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPassword} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">كلمة المرور الحالية</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">كلمة المرور الجديدة</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={pw.revoke} onCheckedChange={(v) => setPw((p) => ({ ...p, revoke: v === true }))} />
              إنهاء الجلسات على الأجهزة الأخرى
            </label>
            {pwError && (
              <p role="alert" className="text-sm text-destructive">
                {pwError}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pwSaving}>
                {pwSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                حفظ
              </Button>
              <Button type="button" variant="outline" onClick={() => setPasswordOpen(false)}>
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!twoFactor} onOpenChange={(o) => !o && setTwoFactor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{twoFactor?.step === "disable" ? "تعطيل التحقق بخطوتين" : "تفعيل التحقق بخطوتين"}</DialogTitle>
            <DialogDescription>
              {twoFactor?.step === "verify" ? "أضف الحساب إلى تطبيق المصادقة (Google Authenticator، Microsoft Authenticator، …) ثم أدخل الرمز الظاهر فيه." : "أكّد هويتك بكلمة المرور."}
            </DialogDescription>
          </DialogHeader>
          {twoFactor && (
            <form onSubmit={twoFactorNext} className="space-y-4" noValidate>
              {twoFactor.step !== "verify" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="tf-password">كلمة المرور</Label>
                  <Input id="tf-password" type="password" autoComplete="current-password" value={twoFactor.password} onChange={(e) => setTwoFactor({ ...twoFactor, password: e.target.value })} />
                </div>
              ) : (
                <>
                  <div className="space-y-2 rounded-[var(--radius)] border border-border p-3 text-sm">
                    <p>مفتاح الإعداد اليدوي:</p>
                    <p className="break-all font-mono text-base tracking-wider" dir="ltr">
                      {secret?.match(/.{1,4}/g)?.join(" ")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => secret && void copyToClipboard(secret).then((ok) => toast[ok ? "success" : "error"](ok ? "تم نسخ المفتاح" : "تعذّر النسخ"))}>
                        <Copy className="h-3.5 w-3.5" />
                        نسخ المفتاح
                      </Button>
                      <Button type="button" size="sm" variant="outline" asChild>
                        <a href={twoFactor.totpURI}>فتح في تطبيق المصادقة (على الهاتف)</a>
                      </Button>
                    </div>
                  </div>
                  {twoFactor.backupCodes && (
                    <div className="space-y-1 rounded-[var(--radius)] border border-gold/30 bg-gold/10 p-3 text-xs">
                      <p className="font-medium">رموز الاسترجاع (احفظها في مكان آمن؛ تظهر مرة واحدة):</p>
                      <p className="font-mono leading-6" dir="ltr">
                        {twoFactor.backupCodes.join("  ")}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="tf-code">رمز التحقق</Label>
                    <Input id="tf-code" dir="ltr" inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="text-center font-mono tracking-[0.4em]" value={twoFactor.code} onChange={(e) => setTwoFactor({ ...twoFactor, code: e.target.value })} />
                  </div>
                </>
              )}
              {twoFactor.error && (
                <p role="alert" className="text-sm text-destructive">
                  {twoFactor.error}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" variant={twoFactor.step === "disable" ? "destructive" : "default"} disabled={twoFactor.busy}>
                  {twoFactor.busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {twoFactor.step === "password" ? "متابعة" : twoFactor.step === "verify" ? "تأكيد التفعيل" : "تعطيل"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setTwoFactor(null)}>
                  إلغاء
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
