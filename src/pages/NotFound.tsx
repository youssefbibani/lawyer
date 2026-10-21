import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius)] border border-gold/30 bg-gold/10">
        <Compass className="h-8 w-8 text-gold-deep" aria-hidden="true" />
      </div>
      <p className="font-mono text-5xl font-medium text-muted-foreground">404</p>
      <h1 className="font-heading text-2xl">الصفحة غير موجودة</h1>
      <p className="max-w-sm text-sm text-muted-foreground">تعذر العثور على الصفحة المطلوبة.</p>
      <Button onClick={() => navigate("/app")} className="mt-2">
        العودة إلى لوحة التحكم
      </Button>
    </div>
  );
}
