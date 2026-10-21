import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDB } from "@/hooks/use-db";
import { saveConversation, deleteConversation } from "@/services/api";
import { newId } from "@/services/db";
import { submitAction } from "@/services/assistant/actions";
import { AbortError, useAssistantProvider } from "@/services/assistant/provider";
import type { ChatMessage, Conversation, PendingAction } from "@/services/assistant/types";

function blankConversation(caseId?: string): Conversation {
  const now = new Date().toISOString();
  return { id: newId("conv"), title: "محادثة جديدة", caseId, createdAt: now, updatedAt: now, messages: [], memory: {} };
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 42 ? `${t.slice(0, 40)}…` : t;
}

export interface ConversationController {
  conversation: Conversation;
  conversations: Conversation[];
  streaming: boolean;
  simulated: boolean;
  send: (text: string, via?: "text" | "voice") => void;
  stop: () => void;
  retry: (assistantMessageId: string) => void;
  clear: () => void;
  startNew: (caseId?: string) => void;
  open: (id: string) => void;
  setCaseId: (caseId?: string) => void;
  updateAction: (messageId: string, patch: Partial<PendingAction>) => void;
  confirmAction: (messageId: string) => void;
  cancelAction: (messageId: string) => void;
}

export function useConversation(initialCaseId?: string): ConversationController {
  const db = useDB();
  const provider = useAssistantProvider();
  const [conversation, setConversation] = useState<Conversation>(() => blankConversation(initialCaseId));
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef(conversation);
  convRef.current = conversation;

  const dirtyRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Persist outside of render: only committed (non-streaming) changes are written.
  useEffect(() => {
    if (dirtyRef.current && conversation.messages.length) {
      dirtyRef.current = false;
      saveConversation(conversation);
    }
  }, [conversation]);

  const conversations = useMemo(() => [...db.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [db.conversations]);

  /** Applies a change; `persist` marks it to be saved once rendered. */
  const commitConversation = useCallback((updater: (c: Conversation) => Conversation, persist = true) => {
    if (persist) dirtyRef.current = true;
    setConversation((prev) => ({ ...updater(prev), updatedAt: new Date().toISOString() }));
  }, []);

  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>), persist = true) =>
      commitConversation((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)) }), persist),
    [commitConversation],
  );

  const run = useCallback(
    async (text: string, base: Conversation, assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      const pending = [...base.messages].reverse().find((m) => m.action?.status === "draft")?.action;
      const history = base.messages
        .filter((m) => m.status === "done" || m.role === "user")
        .map((m) => ({ role: m.role, text: m.text ?? m.blocks?.map((b) => (b.type === "text" ? b.text : "")).join(" ") ?? "" }));
      let buffered = "";
      try {
        for await (const event of provider.send({
          message: text,
          history,
          context: { caseId: base.caseId, memory: base.memory, pendingAction: pending },
          signal: controller.signal,
        })) {
          if (event.type === "text") {
            buffered += event.delta;
            const snapshot = buffered;
            patchMessage(assistantId, { text: snapshot }, false);
          } else if (event.type === "memory") {
            commitConversation((c) => ({ ...c, memory: { ...c.memory, ...event.memory } }), false);
          } else if (event.type === "action") {
            commitConversation(
              (c) => ({
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id === assistantId) return { ...m, action: event.action };
                  if (event.supersedes && m.action?.id === event.supersedes) {
                    return { ...m, action: { ...m.action, status: "cancelled" as const, error: "استُبدلت بمعاينة محدّثة أدناه." } };
                  }
                  return m;
                }),
              }),
              false,
            );
          } else if (event.type === "blocks") {
            patchMessage(assistantId, (m) => ({ blocks: [...(m.blocks ?? []), ...event.blocks] }), false);
          }
        }
        patchMessage(assistantId, { status: "done" });
      } catch (err) {
        if (err instanceof AbortError || controller.signal.aborted) {
          patchMessage(assistantId, (m) => ({ status: "stopped", text: m.text || "" }));
        } else {
          patchMessage(assistantId, {
            status: "error",
            error: "تعذّر الحصول على رد من المساعد. تحقّق من الاتصال ثم أعد المحاولة. لم يتم تنفيذ أي إجراء.",
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [provider, patchMessage, commitConversation],
  );

  const send = useCallback(
    (raw: string, via: "text" | "voice" = "text") => {
      const text = raw.trim();
      if (!text || streaming) return;
      const now = new Date().toISOString();
      const user: ChatMessage = { id: newId("msg"), role: "user", createdAt: now, text, status: "done", via };
      const assistant: ChatMessage = { id: newId("msg"), role: "assistant", createdAt: now, text: "", status: "streaming", simulated: provider.simulated };
      const base = convRef.current;
      const next: Conversation = {
        ...base,
        title: base.messages.length ? base.title : titleFrom(text),
        messages: [...base.messages, user, assistant],
      };
      commitConversation(() => next);
      void run(text, base, assistant.id);
    },
    [streaming, provider.simulated, commitConversation, run],
  );

  const retry = useCallback(
    (assistantMessageId: string) => {
      if (streaming) return;
      const base = convRef.current;
      const index = base.messages.findIndex((m) => m.id === assistantMessageId);
      const userMsg = base.messages.slice(0, index).reverse().find((m) => m.role === "user");
      if (!userMsg?.text) return;
      const trimmed = { ...base, messages: base.messages.filter((m) => m.id !== assistantMessageId) };
      const assistant: ChatMessage = { id: newId("msg"), role: "assistant", createdAt: new Date().toISOString(), text: "", status: "streaming", simulated: provider.simulated };
      commitConversation(() => ({ ...trimmed, messages: [...trimmed.messages, assistant] }));
      void run(userMsg.text, { ...trimmed, messages: trimmed.messages.filter((m) => m.id !== userMsg.id) }, assistant.id);
    },
    [streaming, provider.simulated, commitConversation, run],
  );

  return {
    conversation,
    conversations,
    streaming,
    simulated: provider.simulated,
    send,
    retry,
    stop: () => abortRef.current?.abort(),
    clear: () => {
      abortRef.current?.abort();
      const caseId = convRef.current.caseId;
      deleteConversation(convRef.current.id);
      setConversation(blankConversation(caseId));
    },
    startNew: (caseId) => {
      abortRef.current?.abort();
      setConversation(blankConversation(caseId));
    },
    open: (id) => {
      const found = db.conversations.find((c) => c.id === id);
      if (found) {
        abortRef.current?.abort();
        setConversation(found);
      }
    },
    setCaseId: (caseId) => commitConversation((c) => ({ ...c, caseId, memory: { ...c.memory, lastCaseId: caseId } })),
    updateAction: (messageId, patch) =>
      patchMessage(messageId, (m) => (m.action ? { action: { ...m.action, ...patch, status: m.action.status === "failed" ? "draft" : m.action.status } } : {})),
    confirmAction: (messageId) => {
      const message = convRef.current.messages.find((m) => m.id === messageId);
      if (!message?.action) return;
      const action = message.action;
      patchMessage(messageId, { action: { ...action, status: "executing" } }, false);
      // Only reached from an explicit click on "تأكيد العملية": the proposal goes through the
      // approval engine (approve + execute when this human is an authorised approver).
      const result = submitAction(action, convRef.current.id);
      patchMessage(messageId, {
        action: !result.ok
          ? { ...action, status: "failed", error: result.error }
          : result.data.kind === "executed"
            ? { ...action, status: "done", approvalId: result.data.approvalId, result: result.data.outcome, error: undefined }
            : { ...action, status: "awaiting_approval", approvalId: result.data.approvalId, error: undefined },
      });
      if (result.ok && action.fields.hearingId) {
        commitConversation((c) => ({ ...c, memory: { ...c.memory, lastHearingId: action.fields.hearingId } }));
      }
    },
    cancelAction: (messageId) => patchMessage(messageId, (m) => (m.action ? { action: { ...m.action, status: "cancelled" } } : {})),
  };
}
