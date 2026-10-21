import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mic, MicOff, Pause, Play, RotateCcw, SendHorizontal, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useDB } from "@/hooks/use-db";
import { updatePrefs } from "@/services/api";
import { getRecognitionCtor, STT_ERROR_MESSAGES } from "@/services/speech/stt";
import { useVoiceRecorder } from "@/services/speech/use-voice-recorder";

interface VoicePanelProps {
  onSend: (text: string) => void;
  onClose: () => void;
}

function mmss(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function VoicePanel({ onSend, onClose }: VoicePanelProps) {
  const db = useDB();
  const voice = useVoiceRecorder(db.prefs);
  const [consent, setConsent] = useState(false);
  const browserAvailable = !!getRecognitionCtor();

  // Start immediately when opened; resolves to "unavailable" if nothing is configured.
  useEffect(() => {
    voice.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enableBrowserVoice() {
    const r = updatePrefs({ voiceProvider: "browser", browserVoiceConsent: true });
    if (r.ok) setTimeout(() => voice.start(), 0);
  }

  // When prefs change (after enabling), retry automatically.
  useEffect(() => {
    if (voice.state === "unavailable" && db.prefs.voiceProvider === "browser" && db.prefs.browserVoiceConsent) voice.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.prefs.voiceProvider, db.prefs.browserVoiceConsent]);

  const close = () => {
    voice.cancel();
    onClose();
  };

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-gold/40 bg-card p-3" role="region" aria-label="الإملاء الصوتي">
      <p className="sr-only" aria-live="assertive">
        {voice.state === "recording" ? "جارٍ التسجيل" : voice.state === "paused" ? "التسجيل متوقف مؤقتاً" : voice.state === "review" ? "راجع النص قبل الإرسال" : voice.state === "error" ? "حدث خطأ في الإملاء" : ""}
      </p>

      {voice.state === "unavailable" && voice.error && (
        <div className="space-y-3 text-sm">
          <p className="flex items-start gap-2 text-muted-foreground">
            <MicOff className="mt-0.5 h-4 w-4 shrink-0" />
            {STT_ERROR_MESSAGES[voice.error]}
          </p>
          {(voice.error === "not-configured" || voice.error === "consent-required") && browserAvailable && (
            <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-1" />
                <span className="leading-6">
                  أوافق على إرسال الصوت إلى خدمة التعرّف على الكلام التابعة لمطوّر المتصفح.
                  <span className="block text-xs text-muted-foreground">لا يُحتفظ بأي تسجيل في التطبيق. تجنّب إملاء معطيات سرّية.</span>
                </span>
              </label>
              <Button size="sm" disabled={!consent} onClick={enableBrowserVoice}>
                <Mic className="h-4 w-4" />
                تفعيل الإملاء عبر المتصفح
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/app/settings">إعدادات الصوت</Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              إغلاق
            </Button>
          </div>
        </div>
      )}

      {(voice.state === "recording" || voice.state === "paused") && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
              {voice.state === "recording" && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-alert/40" aria-hidden="true" />}
              <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-alert text-alert-foreground">
                <Mic className="h-5 w-5" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{voice.state === "recording" ? "جارٍ الاستماع..." : "متوقف مؤقتاً"}</p>
              <p className="font-mono text-xs text-muted-foreground">{mmss(voice.elapsed)}</p>
            </div>
          </div>
          <p className="min-h-12 rounded-[var(--radius)] bg-muted/50 p-2.5 text-sm leading-7" aria-live="polite">
            {voice.transcript}
            {voice.interim && <span className="text-muted-foreground"> {voice.interim}</span>}
            {!voice.transcript && !voice.interim && (
              <span className="text-muted-foreground">{voice.live ? "تحدّث بالعربية أو بالدارجة التونسية…" : "سيظهر النص بعد إنهاء التسجيل."}</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {voice.state === "recording" ? (
              <Button variant="outline" onClick={voice.pause}>
                <Pause className="h-4 w-4" />
                إيقاف مؤقت
              </Button>
            ) : (
              <Button variant="outline" onClick={voice.resume}>
                <Play className="h-4 w-4" />
                استئناف
              </Button>
            )}
            <Button onClick={voice.stop}>
              <Square className="h-4 w-4" />
              إنهاء
            </Button>
            <Button variant="ghost" onClick={close}>
              <X className="h-4 w-4" />
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {voice.state === "transcribing" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ تحويل الصوت إلى نص...
        </p>
      )}

      {voice.state === "review" && (
        <div className="space-y-2">
          <label htmlFor="voice-review" className="text-xs font-medium text-muted-foreground">
            راجع النص المكتوب وصحّحه قبل الإرسال:
          </label>
          <Textarea id="voice-review" rows={3} value={voice.transcript} onChange={(e) => voice.setTranscript(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => {
                onSend(voice.transcript);
                voice.reset();
                onClose();
              }}
              disabled={!voice.transcript.trim()}
            >
              <SendHorizontal className="h-4 w-4" />
              إرسال
            </Button>
            <Button variant="outline" onClick={voice.start}>
              <RotateCcw className="h-4 w-4" />
              إعادة
            </Button>
            <Button variant="ghost" onClick={close}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {voice.state === "error" && voice.error && (
        <div className="space-y-2" role="alert">
          <p className="flex items-start gap-2 text-sm text-alert">
            <MicOff className="mt-0.5 h-4 w-4 shrink-0" />
            {STT_ERROR_MESSAGES[voice.error]}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={voice.start}>
              <RotateCcw className="h-4 w-4" />
              إعادة المحاولة
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              إغلاق
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
