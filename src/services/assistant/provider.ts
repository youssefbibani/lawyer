/**
 * Assistant providers.
 *
 * - `DemoAssistantProvider` (default): local rule-based engine over demo data, streamed
 *   word-by-word. Every message it produces is flagged `simulated`.
 * - `RemoteAssistantProvider`: adapter for a backend that runs the LLM server-side with
 *   protected credentials, tool calling and permission filtering. Enabled only when
 *   VITE_ASSISTANT_API_URL is set. Expected response: NDJSON lines of `AssistantStreamEvent`.
 */
import { createContext, useContext } from "react";

import { config } from "@/config";
import { respond, type EngineContext } from "@/services/assistant/engine";
import type { AssistantBlock, ConversationMemory, PendingAction } from "@/services/assistant/types";

export type AssistantStreamEvent =
  | { type: "text"; delta: string }
  | { type: "blocks"; blocks: AssistantBlock[] }
  | { type: "action"; action: PendingAction; supersedes?: string }
  | { type: "memory"; memory: ConversationMemory };

export interface AssistantRequest {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  context: EngineContext;
  signal: AbortSignal;
}

export interface AssistantProvider {
  id: string;
  label: string;
  simulated: boolean;
  send(request: AssistantRequest): AsyncGenerator<AssistantStreamEvent>;
}

export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new AbortError());
    }, { once: true });
  });
}

export class DemoAssistantProvider implements AssistantProvider {
  id = "demo";
  label = "محرك تجريبي محلي";
  simulated = true;

  constructor(private readonly options: { wordDelayMs?: number; thinkMs?: number } = {}) {}

  async *send(request: AssistantRequest): AsyncGenerator<AssistantStreamEvent> {
    await wait(this.options.thinkMs ?? 350, request.signal);
    const response = respond(request.message, request.context);
    const words = response.text.split(/(\s+)/);
    const delay = this.options.wordDelayMs ?? 22;
    for (const word of words) {
      if (delay > 0) await wait(delay, request.signal);
      else if (request.signal.aborted) throw new AbortError();
      yield { type: "text", delta: word };
    }
    if (request.signal.aborted) throw new AbortError();
    yield { type: "memory", memory: response.memory };
    if (response.action) yield { type: "action", action: response.action, supersedes: response.supersedes };
    if (response.blocks.length) yield { type: "blocks", blocks: response.blocks };
  }
}

export class RemoteAssistantProvider implements AssistantProvider {
  id = "remote";
  label = "خادم المساعد";
  simulated = false;

  constructor(private readonly baseUrl: string) {}

  async *send(request: AssistantRequest): AsyncGenerator<AssistantStreamEvent> {
    const res = await fetch(`${this.baseUrl}/assistant/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({
        message: request.message,
        history: request.history.slice(-12),
        caseId: request.context.caseId,
        memory: request.context.memory,
        pendingActionId: request.context.pendingAction?.id,
      }),
      signal: request.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as AssistantStreamEvent;
      }
    }
  }
}

export function createDefaultProvider(): AssistantProvider {
  return config.assistantApiUrl ? new RemoteAssistantProvider(config.assistantApiUrl) : new DemoAssistantProvider();
}

export const AssistantProviderContext = createContext<AssistantProvider>(createDefaultProvider());

export function useAssistantProvider(): AssistantProvider {
  return useContext(AssistantProviderContext);
}
