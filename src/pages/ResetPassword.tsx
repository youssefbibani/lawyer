import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN, resetPassword } from "@/backend/auth";

/** Landing page of the e-mailed reset link (Better Auth redirects here with ?token=…). */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(`كلمة المرور يجب أن تحتوي على ${PASSWORD_MIN} أحرف على الأقل.`);
    if (password !== confirm) return setError("كلمتا المرور غير متطابقتين.");
    setError(undefined);
    setState("saving");
    try {
      await resetPassword(token!, password);
      setState("done");
    } catch (err) {
      setState("idle");
      setError((err as Error).message);
    }
  }

  const invalid = !token || !!linkError;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4 py-12">
      <div className="w-full max-w-md rounded-[var(--radius)] border border-gold/20 bg-night/80 p-6 text-cream shadow-lg sm:p-8">
        <h1 className="mb-4 flex items-center gap-2 font-heading text-xl">
          <KeyRound className="h-5 w-5 text-gold" aria-hidden="true" />
          تعيين كلمة مرور جديدة
        </h1>
        {invalid ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-alert">
              رابط إعادة التعيين غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من صفحة تسجيل الدخول.
            </p>
            <Button asChild variant="gold">
              <Link to="/">العودة إلى تسجيل الدخول</Link>
            </Button>
          </div>
        ) : state === "done" ? (
          <div className="space-y-4">
            <p role="status" className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              تم تغيير كلمة المرور وأُنهيت كل الجلسات السابقة.
            </p>
            <Button asChild variant="gold">
              <Link to="/">تسجيل الدخول</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-cream/80">
                كلمة المرور الجديدة
              </Label>
              <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="border-cream/20 bg-ink/40 text-cream" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-cream/80">
                تأكيد كلمة المرور
              </Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="border-cream/20 bg-ink/40 text-cream" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="gold" className="w-full" disabled={state === "saving"}>
              {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ كلمة المرور"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
