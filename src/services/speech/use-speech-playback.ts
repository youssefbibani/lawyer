import { useCallback, useEffect, useState } from "react";

/**
 * Text-to-speech playback with the browser's speechSynthesis API.
 * Availability of an Arabic voice depends on the operating system; we report it honestly.
 */
export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function arabicVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "ar-TN") ?? voices.find((v) => v.lang.toLowerCase().startsWith("ar"));
}

export function useSpeechPlayback() {
  const supported = speechSynthesisSupported();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hasArabicVoice, setHasArabicVoice] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supported) return;
    const check = () => setHasArabicVoice(!!arabicVoice());
    check();
    window.speechSynthesis.addEventListener?.("voiceschanged", check);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", check);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const speak = useCallback(
    (id: string, text: string, rate = 1) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = arabicVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "ar";
      utterance.rate = rate;
      utterance.onend = () => {
        setSpeakingId(null);
        setPaused(false);
      };
      utterance.onerror = () => {
        setSpeakingId(null);
        setPaused(false);
      };
      setSpeakingId(id);
      setPaused(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  return {
    supported,
    hasArabicVoice,
    speakingId,
    paused,
    speak,
    pause() {
      window.speechSynthesis.pause();
      setPaused(true);
    },
    resume() {
      window.speechSynthesis.resume();
      setPaused(false);
    },
    stop() {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      setPaused(false);
    },
  };
}
