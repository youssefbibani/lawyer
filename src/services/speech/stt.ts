/**
 * Speech-to-text providers.
 *
 * - BrowserSpeechProvider: Web Speech API (Chrome/Edge/Safari). Audio is processed by the
 *   browser vendor's online service, so it is only enabled after explicit consent in Settings.
 * - ServerSpeechProvider: records with MediaRecorder and uploads once to VITE_STT_API_URL.
 *   The recording is kept in memory only until the upload completes, then discarded.
 *
 * Neither provider ever fabricates a transcript: failures surface as typed errors.
 */
import type { AssistantPrefs } from "@/types";
import { config } from "@/config";

export type SttErrorCode =
  | "not-supported"
  | "not-configured"
  | "consent-required"
  | "permission-denied"
  | "audio-capture"
  | "no-speech"
  | "network"
  | "failed";

export const STT_ERROR_MESSAGES: Record<SttErrorCode, string> = {
  "not-supported": "متصفحك لا يدعم التعرّف على الصوت. استعمل Chrome أو Edge أو Safari حديثاً، أو اكتب رسالتك.",
  "not-configured": "الإملاء الصوتي غير مهيأ. لا توجد خدمة تحويل صوت إلى نص مفعّلة لهذا الحساب.",
  "consent-required": "الإملاء عبر المتصفح يرسل الصوت إلى خدمة الشركة المطوّرة للمتصفح. يجب الموافقة على ذلك قبل التفعيل.",
  "permission-denied": "تم رفض الوصول إلى الميكروفون. اسمح بالوصول من إعدادات الموقع في المتصفح ثم أعد المحاولة.",
  "audio-capture": "لم يتم العثور على ميكروفون يعمل في هذا الجهاز.",
  "no-speech": "لم يُلتقط أي كلام. تحدّث بوضوح قرب الميكروفون ثم أعد المحاولة.",
  network: "تعذّر الاتصال بخدمة التعرّف على الصوت. تحقّق من الاتصال وأعد المحاولة.",
  failed: "فشل تحويل التسجيل إلى نص. لم يتم إرسال أي شيء.",
};

export interface SttCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (code: SttErrorCode) => void;
  onEnd: () => void;
}

export interface SttSession {
  pause(): void;
  resume(): void;
  stop(): void;
  cancel(): void;
}

export interface SpeechToTextProvider {
  id: "browser" | "server";
  label: string;
  /** Live interim results while speaking (browser) vs. transcript after stop (server). */
  live: boolean;
  start(callbacks: SttCallbacks): SttSession;
}

// ——— Browser (Web Speech API) ———

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function mapBrowserError(error: string): SttErrorCode | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "audio-capture":
      return "audio-capture";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "aborted":
      return null;
    default:
      return "failed";
  }
}

export class BrowserSpeechProvider implements SpeechToTextProvider {
  id = "browser" as const;
  label = "التعرّف على الصوت عبر المتصفح";
  live = true;

  constructor(private readonly Ctor: RecognitionCtor, private readonly lang = config.speechLanguage) {}

  start(cb: SttCallbacks): SttSession {
    let recognition: RecognitionLike | null = null;
    let paused = false;
    let finished = false;
    let cancelled = false;

    const launch = () => {
      const r = new this.Ctor();
      r.lang = this.lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) cb.onFinal(res[0].transcript.trim());
          else interim += res[0].transcript;
        }
        cb.onInterim(interim.trim());
      };
      r.onerror = (e) => {
        const code = mapBrowserError(e.error);
        if (code && !cancelled) {
          finished = true;
          cb.onError(code);
        }
      };
      r.onend = () => {
        if (cancelled) return;
        if (paused) return; // paused: keep the session open for resume()
        if (!finished) {
          finished = true;
          cb.onEnd();
        }
      };
      recognition = r;
      r.start();
    };

    launch();
    return {
      pause() {
        paused = true;
        recognition?.stop();
      },
      resume() {
        if (!paused) return;
        paused = false;
        launch();
      },
      stop() {
        if (paused) {
          paused = false;
          finished = true;
          cb.onEnd();
          return;
        }
        recognition?.stop();
      },
      cancel() {
        cancelled = true;
        recognition?.abort();
      },
    };
  }
}

// ——— Server (MediaRecorder + upload) ———

export class ServerSpeechProvider implements SpeechToTextProvider {
  id = "server" as const;
  label = "خادم تحويل الصوت إلى نص";
  live = false;

  constructor(private readonly endpoint: string, private readonly lang = config.speechLanguage) {}

  start(cb: SttCallbacks): SttSession {
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let chunks: Blob[] = [];
    let cancelled = false;

    const release = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      chunks = [];
    };

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.onstop = async () => {
          if (cancelled) return release();
          const audio = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
          release(); // the audio exists only in this local variable from here on
          try {
            const form = new FormData();
            form.append("audio", audio, "dictation.webm");
            form.append("lang", this.lang);
            const res = await fetch(this.endpoint, { method: "POST", body: form, credentials: "include" });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { text?: string };
            if (!data.text?.trim()) cb.onError("no-speech");
            else {
              cb.onFinal(data.text.trim());
              cb.onEnd();
            }
          } catch {
            cb.onError("network");
          }
        };
        recorder.start();
      })
      .catch((err: DOMException) => {
        cb.onError(err?.name === "NotAllowedError" || err?.name === "SecurityError" ? "permission-denied" : err?.name === "NotFoundError" ? "audio-capture" : "failed");
      });

    return {
      pause: () => recorder?.state === "recording" && recorder.pause(),
      resume: () => recorder?.state === "paused" && recorder.resume(),
      stop: () => recorder && recorder.state !== "inactive" && recorder.stop(),
      cancel: () => {
        cancelled = true;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
  }
}

export type ProviderResolution = { ok: true; provider: SpeechToTextProvider } | { ok: false; code: SttErrorCode };

/** Picks the configured provider. Returns a typed reason when voice input cannot work. */
export function resolveSpeechProvider(prefs: AssistantPrefs): ProviderResolution {
  if (prefs.voiceProvider === "server") {
    if (!config.speechApiUrl) return { ok: false, code: "not-configured" };
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return { ok: false, code: "not-supported" };
    return { ok: true, provider: new ServerSpeechProvider(config.speechApiUrl) };
  }
  if (prefs.voiceProvider === "browser") {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return { ok: false, code: "not-supported" };
    if (!prefs.browserVoiceConsent) return { ok: false, code: "consent-required" };
    return { ok: true, provider: new BrowserSpeechProvider(Ctor) };
  }
  return { ok: false, code: getRecognitionCtor() ? "not-configured" : config.speechApiUrl ? "not-configured" : "not-supported" };
}
