import { useState } from "react";
import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";
import { isDemoMode } from "@/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const POINTS = [
  "لا يوجد خادم متصل: القضايا والجلسات والمهام تُحفظ محلياً في هذا المتصفح فقط ويمكن إعادتها إلى حالتها الأصلية من الإعدادات.",
  "المساعد الذكي يعمل بمحرك قواعد محلي على بيانات تجريبية، وليس بنموذج لغوي. كل ردوده موسومة «تجريبي».",
  "لا تُرسل أي رسائل بريد إلكتروني أو SMS. التذكيرات داخل التطبيق تظهر فقط أثناء فتحه.",
  "استخراج النص (OCR) وتصنيف الوثائق المرفوعة محاكاة ولا يحلل محتوى الملف فعلياً.",
  "الإملاء الصوتي يعمل فقط عبر واجهة المتصفح بعد موافقتك، أو عبر خادم يتم ضبطه.",
  "لا تُدخل بيانات موكّلين حقيقية في هذه النسخة.",
];

export function DemoModeBadge({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variant === "sidebar"
            ? "min-h-10 w-full justify-center border-gold/30 bg-gold/10 px-3 text-gold short:min-h-8 coarse:min-h-11"
            : "min-h-9 border-gold/40 bg-gold/10 px-2.5 text-gold-deep coarse:min-h-11",
        )}
      >
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        {isDemoMode ? "وضع تجريبي" : "متصل بالخادم"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>نسخة تجريبية تفاعلية</DialogTitle>
            <DialogDescription>ما الذي يعمل فعلياً وما الذي يُحاكى في هذه النسخة:</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm leading-7">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>فهمت</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
