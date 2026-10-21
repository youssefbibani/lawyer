import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Scale, Eye, EyeOff, ShieldCheck, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requestPasswordReset, signIn, verifyBackupCode, verifyTotp } from "@/backend/auth";
import { useMe } from "@/backend/queries";

const loginSchema = z.object({
  email: z.string().min(1, "يرجى إدخال البريد الإلكتروني").email("البريد الإلكتروني غير صالح"),
  password: z.string().min(1, "يرجى إدخال كلمة المرور"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const inputClass = "border-cream/20 bg-ink/40 text-cream placeholder:text-cream/30 focus-visible:ring-gold";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useMe();
  const from = (location.state as { from?: string; expired?: boolean } | null)?.from;
  const expired = (location.state as { expired?: boolean } | null)?.expired;
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<"credentials" | "two-factor">("credentials");
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  if (me.data) return <Navigate to={from && from.startsWith("/app") ? from : "/app"} replace />;

  async function finish() {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    toast.success("تم تسجيل الدخول بنجاح");
    navigate(from && from.startsWith("/app") ? from : "/app", { replace: true });
  }

  async function onSubmit(data: LoginFormValues) {
    setLoading(true);
    setError(undefined);
    try {
      const result = await signIn(data.email.trim(), data.password, remember);
      if (result.twoFactor) {
        setStep("two-factor");
        return;
      }
      await finish();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError("يرجى إدخال الرمز");
    setLoading(true);
    setError(undefined);
    try {
      if (useBackup) await verifyBackupCode(code.trim());
      else await verifyTotp(code.trim());
      await finish();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onRequestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!z.string().email().safeParse(resetEmail.trim()).success) return toast.error("البريد الإلكتروني غير صالح");
    setResetState("sending");
    try {
      await requestPasswordReset(resetEmail.trim());
      setResetState("sent");
    } catch (err) {
      setResetState("idle");
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "radial-gradient(hsl(43 53% 54%) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gold/20 blur-[120px]" aria-hidden="true" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center animate-fade-in">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-[var(--radius)] border border-gold/40 bg-gold/10">
          <Scale className="h-8 w-8 text-gold" aria-hidden="true" />
        </div>
        <h1 className="font-heading text-3xl text-cream">قصر العدالة</h1>
        <div className="gold-line my-3" />
        <p className="mb-8 text-sm text-cream/60">منصة المحامين بمحكمة التعقيب</p>

        <div className="w-full rounded-[var(--radius)] border border-gold/20 bg-night/80 p-6 shadow-lg backdrop-blur-sm sm:p-8">
          {expired && step === "credentials" && (
            <p role="status" className="mb-4 rounded-sm border border-gold/30 bg-gold/10 p-3 text-xs text-cream/80">
              انتهت جلستك. يرجى تسجيل الدخول من جديد.
            </p>
          )}

          {step === "credentials" ? (
            <>
              <h2 className="font-heading text-xl text-cream">تسجيل الدخول</h2>
              <p className="mb-6 mt-1 text-sm text-cream/60">أدخل بياناتك للوصول إلى ملفاتك</p>
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-cream/80">
                    البريد الإلكتروني
                  </Label>
                  <Input id="email" type="email" dir="ltr" autoComplete="username" className={`${inputClass} text-left`} {...register("email")} />
                  {errors.email && <p className="text-xs font-medium text-alert">{errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-cream/80">
                    كلمة المرور
                  </Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" className={`${inputClass} pl-12`} {...register("password")} />
                    <button
                      type="button"
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute left-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm text-cream/50 coarse:h-11 coarse:w-11 hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs font-medium text-alert">{errors.password.message}</p>}
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                    <Label htmlFor="remember" className="cursor-pointer font-normal text-cream/70">
                      تذكرني
                    </Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResetState("idle");
                      setResetOpen(true);
                    }}
                    className="text-cream/60 underline-offset-2 hover:text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>

                {error && (
                  <p role="alert" className="text-sm font-medium text-alert">
                    {error}
                  </p>
                )}

                <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جارٍ التحقق...
                    </>
                  ) : (
                    "تسجيل الدخول"
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="flex items-center gap-2 font-heading text-xl text-cream">
                <KeyRound className="h-5 w-5 text-gold" aria-hidden="true" />
                التحقق بخطوتين
              </h2>
              <p className="mb-6 mt-1 text-sm text-cream/60">
                {useBackup ? "أدخل أحد رموز الاسترجاع الاحتياطية." : "أدخل الرمز المكوّن من 6 أرقام الظاهر في تطبيق المصادقة."}
              </p>
              <form onSubmit={onVerify} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="otp" className="text-cream/80">
                    {useBackup ? "رمز الاسترجاع" : "رمز التحقق"}
                  </Label>
                  <Input
                    id="otp"
                    dir="ltr"
                    inputMode={useBackup ? "text" : "numeric"}
                    autoComplete="one-time-code"
                    maxLength={useBackup ? 32 : 6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={`${inputClass} text-center font-mono tracking-[0.4em]`}
                    autoFocus
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm font-medium text-alert">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "تأكيد"}
                </Button>
                <div className="flex justify-between text-xs">
                  <button type="button" className="text-cream/60 hover:text-gold" onClick={() => (setUseBackup((b) => !b), setCode(""), setError(undefined))}>
                    {useBackup ? "استعمال تطبيق المصادقة" : "استعمال رمز استرجاع"}
                  </button>
                  <button type="button" className="text-cream/60 hover:text-gold" onClick={() => (setStep("credentials"), setCode(""), setError(undefined))}>
                    رجوع
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-xs text-cream/50">
            <ShieldCheck className="h-4 w-4 text-gold/70" aria-hidden="true" />
            بيانات المكتب محفوظة على خادم المكتب — المساعد الذكي والأرشفة ما زالا في وضع تجريبي محلي
          </p>
          <p className="text-xs text-cream/30">© 2026 قصر العدالة — جميع الحقوق محفوظة</p>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>استعادة كلمة المرور</DialogTitle>
            <DialogDescription>أدخل بريدك الإلكتروني المسجّل لدى المكتب.</DialogDescription>
          </DialogHeader>
          {resetState === "sent" ? (
            <p role="status" className="text-sm leading-7">
              إذا كان هذا البريد مسجّلاً فستصلك رسالة تتضمن رابطاً صالحاً لمدة ساعة. إن لم تصلك أي رسالة، فقد لا تكون خدمة البريد مهيأة على الخادم: تواصل مع مدير المكتب لتعيين كلمة مرور جديدة.
            </p>
          ) : (
            <form onSubmit={onRequestReset} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">البريد الإلكتروني</Label>
                <Input id="reset-email" type="email" dir="ltr" className="text-left" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={resetState === "sending"}>
                  {resetState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : "إرسال رابط الاستعادة"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
                  إلغاء
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
