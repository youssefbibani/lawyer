import { useCallback, useEffect, useRef, useState } from "react";

import type { AssistantPrefs } from "@/types";
import { resolveSpeechProvider, type SttErrorCode, type SttSession } from "@/services/speech/stt";

export type VoiceState = "idle" | "unavailable" | "recording" | "paused" | "transcribing" | "review" | "error";

export interface VoiceRecorder {
  state: VoiceState;
  error?: SttErrorCode;
  transcript: string;
  interim: string;
  elapsed: number;
  live: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  cancel(): void;
  setTranscript(text: string): void;
  reset(): void;
}

export function useVoiceRecorder(prefs: AssistantPrefs): VoiceRecorder {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<SttErrorCode>();
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState(true);
  const session = useRef<SttSession | null>(null);
  const finals = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const stateRef = useRef(state);
  stateRef.current = state;

  const stopTimer = () => timer.current && clearInterval(timer.current);
  const startTimer = () => {
    stopTimer();
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };

  useEffect(() => () => {
    stopTimer();
    session.current?.cancel();
  }, []);

  const start = useCallback(() => {
    const resolution = resolveSpeechProvider(prefs);
    if (!resolution.ok) {
      setError(resolution.code);
      setState("unavailable");
      return;
    }
    finals.current = [];
    setTranscript("");
    setInterim("");
    setError(undefined);
    setElapsed(0);
    setLive(resolution.provider.live);
    setState("recording");
    startTimer();
    session.current = resolution.provider.start({
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        if (!text) return;
        finals.current.push(text);
        setTranscript(finals.current.join(" "));
        setInterim("");
      },
      onError: (code) => {
        stopTimer();
        session.current = null;
        setError(code);
        setState("error");
      },
      onEnd: () => {
        stopTimer();
        session.current = null;
        if (stateRef.current === "error") return;
        if (finals.current.length === 0) {
          setError("no-speech");
          setState("error");
        } else {
          setState("review");
        }
      },
    });
  }, [prefs]);

  return {
    state,
    error,
    transcript,
    interim,
    elapsed,
    live,
    start,
    pause() {
      if (stateRef.current !== "recording") return;
      session.current?.pause();
      stopTimer();
      setState("paused");
    },
    resume() {
      if (stateRef.current !== "paused") return;
      session.current?.resume();
      startTimer();
      setState("recording");
    },
    stop() {
      if (stateRef.current !== "recording" && stateRef.current !== "paused") return;
      stopTimer();
      setState("transcribing");
      session.current?.stop();
    },
    cancel() {
      session.current?.cancel();
      session.current = null;
      stopTimer();
      finals.current = [];
      setTranscript("");
      setInterim("");
      setError(undefined);
      setState("idle");
    },
    setTranscript,
    reset() {
      finals.current = [];
      setTranscript("");
      setInterim("");
      setError(undefined);
      setState("idle");
    },
  };
}
