import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ImageUp, Loader2, RotateCcw, ScanText, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { todayISO } from "@/backend/format";
import { scanCaseDocument, ScanUnavailableError, type ScanKey, type ScanSuggestion } from "@/services/cases/scan";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; progress: number }
  | { kind: "review"; suggestions: ScanSuggestion[]; readingConfidence: number }
  | { kind: "error"; message: string }
  | { kind: "done"; count: number };

/** Suggestions at or above this confidence are ticked by default. */
const PRESELECT = 60;

function reliability(c: number): { label: string; tone: string } {
  return c >= 80 ? { label: "موثوق", tone: "bg-success/15 text-success" } : c >= PRESELECT ? { label: "مرجّح", tone: "bg-gold/15 text-gold-deep" } : { label: "للتحقق", tone: "bg-alert/10 text-alert" };
}

/**
 * Camera strip of the new-case form: photograph a document, review what was read, then fill the
 * form. The lawyer approves twice: here (which values to use) and when saving the case.
 */
export function CaseScan({ onApply, onUndo }: { onApply: (values: Partial<Record<ScanKey, string>>) => void; onUndo: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [preview, setPreview] = useState<string>();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function read(file: File | undefined) {
    if (!file) return;
    const id = ++run.current;
    setPreview(URL.createObjectURL(file));
    setPhase({ kind: "reading", progress: 0 });
    try {
      const result = await scanCaseDocument(file, todayISO(), (f) => id === run.current && setPhase({ kind: "reading", progress: Math.round(f * 100) }));
      if (id !== run.current) return;
      if (!result.suggestions.length) {
        setPhase({ kind: "error", message: "لم نتعرّف على بيانات قضية في هذه الصورة. صوّر الصفحة الأولى من الوثيقة كاملة، في إضاءة جيدة ودون ميلان." });
        return;
      }
      setPicked(Object.fromEntries(result.suggestions.map((s) => [s.key, s.confidence >= PRESELECT])));
      setEdited(Object.fromEntries(result.suggestions.map((s) => [s.key, s.display ? s.display : s.value])));
      setPhase({ kind: "review", suggestions: result.suggestions, readingConfidence: result.readingConfidence });
    } catch (err) {
      if (id !== run.current) return;
      setPhase({ kind: "error", message: err instanceof ScanUnavailableError ? err.message : "تعذّرت قراءة الصورة. أعد المحاولة أو أدخل البيانات يدوياً." });
    }
  }

  function reset() {
    run.current++;
    setPhase({ kind: "idle" });
    setPreview(undefined);
  }

  function apply(suggestions: ScanSuggestion[]) {
    const values: Partial<Record<ScanKey, string>> = {};
    for (const s of suggestions) {
      if (!picked[s.key]) continue;
      // Edited text replaces the suggestion, except for the case type which is chosen from the list.
      values[s.key] = s.display ? s.value : (edited[s.key] ?? s.value).trim();
    }
    const count = Object.values(values).filter(Boolean).length;
    if (!count) return;
    onApply(values);
    setPhase({ kind: "done", count });
  }

  // One picker: on phones it already offers "Camera" or "Photos"; on computers it opens the file chooser.
  const inputs = (
    <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => (void read(e.target.files?.[0]), (e.target.value = ""))} />
  );
  const pick = () => fileRef.current?.click();

  if (phase.kind === "done") {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-success/40 bg-success/5 p-3 text-sm">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          تمت تعبئة {phase.count} خانات من الوثيقة. <span className="text-muted-foreground">راجعها (مؤطّرة بالذهبي) قبل حفظ القضية.</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => (onUndo(), reset())}>
          <RotateCcw className="h-4 w-4" />
          تراجع
        </Button>
      </div>
    );
  }

  // Idle: one slim line — a button and a short privacy hint.
  if (phase.kind === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {inputs}
        <button
          type="button"
          onClick={pick}
          aria-label="تصوير وثيقة"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-gold/70 bg-gold/5 pe-4 ps-1 text-sm font-medium transition-colors hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-ink" aria-hidden="true">
            <Camera className="h-3.5 w-3.5" />
          </span>
          املأ من صورة وثيقة
        </button>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          تُقرأ على جهازك، ولا تُرسل
        </span>
      </div>
    );
  }

  return (
    <section aria-label="تعبئة من صورة وثيقة" className="overflow-hidden rounded-[var(--radius)] border border-dashed border-gold/60 bg-gold/5">
      {inputs}
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4 text-gold-deep" aria-hidden="true" />
          املأ من صورة وثيقة
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={pick} disabled={phase.kind === "reading"}>
          <ImageUp className="h-4 w-4" />
          صورة أخرى
        </Button>
      </div>

      {phase.kind === "reading" && (
        <div className="flex items-center gap-3 border-t border-gold/20 p-3" aria-live="polite">
          {preview && <img src={preview} alt="" className="h-14 w-11 shrink-0 rounded-sm border border-border object-cover" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-gold-deep" aria-hidden="true" />
              جارٍ قراءة الوثيقة… {phase.progress ? `${phase.progress}%` : ""}
            </p>
            <Progress value={phase.progress} aria-label="تقدّم القراءة" />
            <p className="text-[11px] text-muted-foreground">أول استعمال قد يستغرق وقتاً أطول (تحميل نماذج اللغة).</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={reset} aria-label="إلغاء القراءة">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {phase.kind === "error" && (
        <div role="alert" className="flex items-start gap-3 border-t border-gold/20 p-3 text-sm">
          <ScanText className="mt-0.5 h-4 w-4 shrink-0 text-alert" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-alert">{phase.message}</p>
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            إغلاق
          </Button>
        </div>
      )}

      {phase.kind === "review" && (
        <div className="space-y-3 border-t border-gold/20 bg-card p-3">
          <div className="flex items-start gap-3">
            {preview && <img src={preview} alt="الوثيقة المصوّرة" className="h-20 w-16 shrink-0 rounded-sm border border-border object-cover" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold">راجع ما قرأناه من الوثيقة</p>
              <p className="text-xs text-muted-foreground">اختر الخانات التي تريد تعبئتها وصحّح أي قيمة. لن يُحفظ شيء قبل أن تضغط «حفظ القضية».</p>
              {phase.readingConfidence < 60 && <p className="mt-1 text-xs text-alert">الصورة غير واضحة بما يكفي: تحقّق جيداً من كل قيمة أو أعد التصوير.</p>}
            </div>
          </div>
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {phase.suggestions.map((s) => {
              const r = reliability(s.confidence);
              const id = `scan-${s.key}`;
              return (
                <li key={s.key} className={cn("flex items-start gap-3 p-2.5", !picked[s.key] && "opacity-60")}>
                  <Checkbox id={id} checked={!!picked[s.key]} onCheckedChange={(v) => setPicked((p) => ({ ...p, [s.key]: v === true }))} className="mt-2.5" aria-label={`استعمال ${s.label}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                        {s.label}
                      </label>
                      <span className={cn("rounded-sm px-1.5 text-[10px] font-medium", r.tone)}>{r.label}</span>
                    </div>
                    {s.display ? (
                      <p className="text-sm font-medium">{s.display}</p>
                    ) : (
                      <Input
                        value={edited[s.key] ?? ""}
                        onChange={(e) => setEdited((v) => ({ ...v, [s.key]: e.target.value }))}
                        aria-label={s.label}
                        dir={s.key === "reference" || s.key === "hearingDate" ? "ltr" : undefined}
                        className={cn("h-9", (s.key === "reference" || s.key === "hearingDate") && "text-left font-mono")}
                      />
                    )}
                    {s.evidence && <p className="truncate text-[11px] text-muted-foreground">من الوثيقة: «{s.evidence}»</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => apply(phase.suggestions)} disabled={!Object.values(picked).some(Boolean)}>
              <CheckCircle2 className="h-4 w-4" />
              تعبئة الخانات المختارة
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              تجاهل
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
