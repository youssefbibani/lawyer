import { describe, expect, it, vi } from "vitest";

import { BrowserSpeechProvider, MAX_SILENT_RESTARTS } from "@/services/speech/stt";

/** A stand-in for the browser's SpeechRecognition that the test drives by hand. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static throwOnStart = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error("InvalidStateError");
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}

function setup() {
  FakeRecognition.instances = [];
  FakeRecognition.throwOnStart = false;
  const cb = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
  const session = new BrowserSpeechProvider(FakeRecognition as never, "ar-TN").start(cb);
  const current = () => FakeRecognition.instances.at(-1)!;
  return { cb, session, current };
}

describe("browser dictation", () => {
  it("keeps listening when the browser stops by itself after a pause in speech", () => {
    const { cb, session, current } = setup();
    current().say("جلسة يوم الإثنين", true);
    // Chrome reports silence, then ends the session on its own.
    current().onerror?.({ error: "no-speech" });
    current().onend?.();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onEnd).not.toHaveBeenCalled();
    expect(FakeRecognition.instances).toHaveLength(2); // restarted
    current().say("في المحكمة الابتدائية", true);
    session.stop();
    expect(cb.onFinal.mock.calls.map((c) => c[0])).toEqual(["جلسة يوم الإثنين", "في المحكمة الابتدائية"]);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps the words still pending when the user presses stop", () => {
    const { cb, session, current } = setup();
    current().say("ذكّرني بجلسة", false);
    session.stop();
    expect(cb.onFinal).toHaveBeenCalledWith("ذكّرني بجلسة");
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it("retries after a short network drop, then reports a lasting one", () => {
    const { cb, current } = setup();
    current().onerror?.({ error: "network" });
    current().onend?.();
    expect(cb.onError).not.toHaveBeenCalled();
    current().onerror?.({ error: "network" });
    current().onend?.();
    current().onerror?.({ error: "network" });
    expect(cb.onError).toHaveBeenCalledWith("network");
  });

  it("ends by itself after a long silence, and reports a microphone refusal at once", () => {
    const { cb, current } = setup();
    for (let i = 0; i <= MAX_SILENT_RESTARTS; i++) current().onend?.();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);

    const second = setup();
    second.current().onerror?.({ error: "not-allowed" });
    expect(second.cb.onError).toHaveBeenCalledWith("permission-denied");
  });

  it("reports a failure instead of crashing when the browser refuses to start", () => {
    FakeRecognition.instances = [];
    FakeRecognition.throwOnStart = true;
    const cb = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    expect(() => new BrowserSpeechProvider(FakeRecognition as never, "ar-TN").start(cb)).not.toThrow();
    expect(cb.onError).toHaveBeenCalledWith("failed");
    FakeRecognition.throwOnStart = false;
  });
});
