import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, BookOpenCheck, History, MessageSquarePlus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Composer } from "@/components/assistant/Composer";
import { MessageBubble } from "@/components/assistant/MessageBubble";
import { useConversation } from "@/components/assistant/useConversation";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { accessibleCases, documentsForCase, findAccessibleCase } from "@/services/api";
import { useSpeechPlayback } from "@/services/speech/use-speech-playback";
import { formatRelativeDay } from "@/lib/formatters";
import type { Conversation } from "@/services/assistant/types";

export const SUGGESTED_PROMPTS = [
  "حضّرلي ملخص للقضية متاع عائلة بن صالح",
  "شنوة الجلسات اللي عندي الأسبوع الجاي؟",
  "اقترح حجج قانونية للملف هذا",
  "فتّشلي على حكم قديم في نزاع ميراث",
  "ذكّرني بموعد الجلسة",
  "ورّيني الأتعاب اللي مازالت ما تخلّصتش",
];

const NO_CASE = "__none__";

function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
}: {
  conversations: Conversation[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const db = useDB();
  const user = useCurrentUser();
  const briefs = db.briefs.filter((b) => findAccessibleCase(b.caseId, db, user));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <Button variant="outline" className="w-full" onClick={onNew}>
          <MessageSquarePlus className="h-4 w-4" />
          محادثة جديدة
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <section>
          <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">المحادثات الأخيرة</p>
          {conversations.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">لا توجد محادثات محفوظة.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => {
                const legalCase = db.cases.find((x) => x.id === c.caseId);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      aria-current={c.id === activeId ? "true" : undefined}
                      className={cn(
                        "w-full rounded-[var(--radius)] px-2.5 py-2 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11",
                        c.id === activeId ? "bg-gold/15" : "hover:bg-secondary",
                      )}
                    >
                      <p className="truncate text-sm">{c.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {legalCase ? `${legalCase.client} • ` : ""}
                        {formatRelativeDay(c.updatedAt.slice(0, 10))}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {briefs.length > 0 && (
          <section>
            <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">المذكرات التحضيرية المحفوظة</p>
            <ul className="space-y-1">
              {briefs.map((b) => (
                <li key={b.id}>
                  <Link to={`/app/assistant/briefs/${b.id}`} className="flex min-h-11 items-start gap-2 rounded-[var(--radius)] px-2.5 py-2 text-sm hover:bg-secondary">
                    <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="line-clamp-2">{b.title}</span>
                      <span className="text-[11px] text-muted-foreground">{b.reviewed ? "تمت المراجعة" : "مسودة غير مراجعة"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  const db = useDB();
  const user = useCurrentUser();
  const initialCase = findAccessibleCase(params.get("case") ?? undefined, db, user)?.id;
  const chat = useConversation(initialCase);
  const speech = useSpeechPlayback();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const { scrollerRef, contentRef, atBottom, hasNewContent, scrollToBottom } = useStickToBottom({ resetKey: chat.conversation.id });
  const autoSent = useRef(false);

  const cases = useMemo(() => accessibleCases(db, user), [db, user]);
  const activeCase = cases.find((c) => c.id === chat.conversation.caseId);
  const caseDocs = useMemo(() => (activeCase ? documentsForCase(activeCase.id, db, user) : []), [activeCase, db, user]);
  const messages = chat.conversation.messages;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  // Deep links: ?prompt= sends once; ?c= reopens a conversation. Deferred so React
  // StrictMode's simulated unmount cannot abort the request it just started.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (autoSent.current) return;
      autoSent.current = true;
      const convId = params.get("c");
      if (convId) chat.open(convId);
      const prompt = params.get("prompt");
      if (prompt) chat.send(prompt);
      if (convId || prompt || params.get("case")) setParams({}, { replace: true });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sending always brings you to your message and the reply, even if you were reading higher up.
  const send = useCallback(
    (text: string, via?: "text" | "voice") => {
      scrollToBottom();
      chat.send(text, via);
    },
    [chat.send, scrollToBottom],
  );

  const conversationList = (
    <ConversationList
      conversations={chat.conversations}
      activeId={chat.conversation.id}
      onOpen={(id) => {
        chat.open(id);
        setHistoryOpen(false);
      }}
      onNew={() => {
        chat.startNew(chat.conversation.caseId);
        setHistoryOpen(false);
      }}
    />
  );

  return (
    <AppShell title="المساعد القانوني الذكي" subtitle={activeCase ? `${activeCase.client} — ${activeCase.ref}` : "محادثة عامة"} fullHeight>
      <div className="flex min-h-0 flex-1 pb-[var(--keyboard-inset)]">
        <aside className="hidden w-72 shrink-0 flex-col border-l border-border lg:flex" aria-label="سجل المحادثات">
          {conversationList}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" aria-label="المحادثة">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:px-6">
            <Button variant="ghost" size="icon" aria-label="سجل المحادثات" onClick={() => setHistoryOpen(true)} className="shrink-0 lg:hidden">
              <History className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Select value={chat.conversation.caseId ?? NO_CASE} onValueChange={(v) => chat.setCaseId(v === NO_CASE ? undefined : v)}>
                <SelectTrigger aria-label="القضية المرتبطة بالمحادثة" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CASE}>بدون قضية محددة</SelectItem>
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.client} — {c.ref}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" aria-label="محادثة جديدة" onClick={() => chat.startNew(chat.conversation.caseId)} className="shrink-0">
              <MessageSquarePlus className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="حذف المحادثة" disabled={!messages.length} onClick={() => setConfirmClear(true)} className="shrink-0">
              <Trash2 className="h-5 w-5" />
            </Button>
            {chat.simulated && (
              <span className="hidden shrink-0 rounded-sm border border-gold/40 bg-gold/10 px-2 py-1 text-[11px] text-gold-deep sm:inline">محرك تجريبي محلي</span>
            )}
          </div>

          <div className="relative min-h-0 flex-1">
            <div ref={scrollerRef} className="h-full overflow-y-auto overscroll-contain px-3 py-4 [overflow-anchor:none] sm:px-6">
              <div ref={contentRef}>
                {messages.length === 0 ? (
                  <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 py-6 text-center sm:py-10">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-night text-gold shadow-gold">
                      <Sparkles className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="font-heading text-2xl">كيف يمكنني مساعدتك اليوم؟</h2>
                      <p className="text-sm leading-7 text-muted-foreground">
                        أجيب انطلاقاً من ملفات المكتب ووثائقه المصرّح لك بها فقط، وأميّز دائماً بين النص المسترجع واقتراحاتي.
                        {activeCase ? ` المحادثة مرتبطة بملف ${activeCase.client}.` : ""}
                      </p>
                    </div>
                    <ul className="grid grid-cols-1 w-full gap-2 sm:grid-cols-2" aria-label="اقتراحات">
                      {SUGGESTED_PROMPTS.map((p) => (
                        <li key={p}>
                          <button
                            type="button"
                            onClick={() => send(p)}
                            className="flex h-full min-h-14 w-full items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5 text-right text-sm leading-6 transition-colors hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Sparkles className="h-4 w-4 shrink-0 text-gold-deep" aria-hidden="true" />
                            <span className="min-w-0">{p}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      أي إضافة أو تعديل (جلسة، مهمة، تذكير، دفعة) يتطلب تأكيدك الصريح قبل الحفظ.
                    </p>
                  </div>
                ) : (
                  <ol className="mx-auto max-w-3xl space-y-5" aria-live="polite" aria-relevant="additions">
                    {messages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        isLast={m.id === lastAssistantId}
                        speech={db.prefs.speechPlayback ? speech : undefined}
                        onRetry={() => chat.retry(m.id)}
                        onActionChange={(patch) => chat.updateAction(m.id, patch)}
                        onActionConfirm={() => chat.confirmAction(m.id)}
                        onActionCancel={() => chat.cancelAction(m.id)}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </div>
            {!atBottom && messages.length > 0 && (
              <Button
                variant={hasNewContent ? "gold" : "outline"}
                size={hasNewContent ? "sm" : "icon"}
                aria-label="الانتقال إلى آخر رسالة"
                onClick={() => scrollToBottom("smooth")}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
              >
                <ArrowDown className="h-4 w-4" />
                {hasNewContent && "رد جديد"}
              </Button>
            )}
          </div>

          <div className="shrink-0 border-t border-border bg-background px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-1.5">
              <Composer
                onSend={send}
                onStop={chat.stop}
                streaming={chat.streaming}
                caseDocuments={caseDocs}
                caseId={activeCase?.id}
              />
              <p className="text-center text-[11px] leading-5 text-muted-foreground">
                مساعد للبحث والتحضير فقط — لا يقدّم استشارة قانونية معتمدة. المراجعة من طرف المحامي إلزامية.
              </p>
            </div>
          </div>
        </section>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="bg-background text-foreground">
          <SheetHeader className="border-b border-border pl-14">
            <SheetTitle>المحادثات</SheetTitle>
          </SheetHeader>
          {conversationList}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="حذف المحادثة"
        description="سيتم حذف هذه المحادثة نهائياً. الإجراءات التي سبق تأكيدها وحفظها لن تتأثر."
        confirmLabel="حذف"
        tone="destructive"
        onConfirm={chat.clear}
      />
    </AppShell>
  );
}
