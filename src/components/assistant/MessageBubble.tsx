import { AlertCircle, Copy, Mic, Pause, Play, RotateCcw, Sparkles, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatters";
import { copyToClipboard } from "@/lib/print";
import { MessageBlock } from "@/components/assistant/MessageBlocks";
import { ActionCard } from "@/components/assistant/ActionCard";
import type { ChatMessage, PendingAction } from "@/services/assistant/types";
import type { useSpeechPlayback } from "@/services/speech/use-speech-playback";

interface MessageBubbleProps {
  message: ChatMessage;
  isLast: boolean;
  onRetry: () => void;
  onActionChange: (patch: Partial<PendingAction>) => void;
  onActionConfirm: () => void;
  onActionCancel: () => void;
  speech?: ReturnType<typeof useSpeechPlayback>;
}

function plainText(m: ChatMessage): string {
  const parts = [m.text ?? ""];
  for (const b of m.blocks ?? []) {
    if (b.type === "text" || b.type === "notice") parts.push(b.text);
    if (b.type === "list") parts.push(...b.items.map((i) => [i.title, i.meta].filter(Boolean).join(" — ")));
    if (b.type === "suggestions") parts.push(b.title, ...b.items);
  }
  return parts.filter(Boolean).join("\n");
}

const iconBtn =
  "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11";

export function MessageBubble({ message, isLast, onRetry, onActionChange, onActionConfirm, onActionCancel, speech }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <li className="flex justify-start" aria-label="رسالتك">
        <div className="max-w-[85%] space-y-1 sm:max-w-[75%]">
          <div className="break-anywhere whitespace-pre-line rounded-2xl rounded-tr-sm bg-night px-4 py-2.5 text-sm leading-7 text-cream shadow-sm dark:bg-gold/20 dark:text-foreground" dir="auto">
            {message.text}
          </div>
          <p className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            {message.via === "voice" && <Mic className="h-3 w-3" aria-label="عبر الإملاء الصوتي" />}
            <span className="font-mono">{formatTime(message.createdAt)}</span>
          </p>
        </div>
      </li>
    );
  }

  const speaking = speech?.speakingId === message.id;
  const streaming = message.status === "streaming";

  return (
    <li className="flex justify-end" aria-label="رد المساعد" aria-busy={streaming}>
      <div className="w-full max-w-[94%] space-y-1 sm:max-w-[85%]">
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-night text-gold">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
          </span>
          المساعد
          {message.simulated && <span className="rounded-sm border border-gold/40 px-1 text-[10px] text-gold-deep">تجريبي</span>}
          <span className="font-mono">{formatTime(message.createdAt)}</span>
        </div>
        <div className={cn("space-y-3 rounded-2xl rounded-tl-sm border bg-card px-3.5 py-3 shadow-sm sm:px-4", message.status === "error" ? "border-alert/40" : "border-border")}>
          {streaming && !message.text ? (
            <p className="flex items-center gap-1.5 py-1" aria-label="المساعد يكتب">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-gold" style={{ animationDelay: `${i * 160}ms` }} />
              ))}
            </p>
          ) : (
            message.text && (
              <p className="whitespace-pre-line text-sm leading-7">
                {message.text}
                {streaming && <span className="mr-0.5 inline-block h-4 w-1.5 animate-pulse bg-gold align-middle" aria-hidden="true" />}
              </p>
            )
          )}

          {message.action && (
            <ActionCard action={message.action} onChange={onActionChange} onConfirm={onActionConfirm} onCancel={onActionCancel} />
          )}

          {message.blocks?.filter((b) => b.type !== "action").map((b, i) => <MessageBlock key={i} block={b} />)}

          {message.status === "error" && (
            <p className="flex items-start gap-2 text-sm text-alert" role="alert">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
              {message.error}
            </p>
          )}
          {message.status === "stopped" && <p className="text-xs text-muted-foreground">تم إيقاف التوليد. الرد أعلاه غير مكتمل.</p>}
        </div>

        {!streaming && (
          <div className="flex items-center gap-0.5 px-1">
            <button
              type="button"
              className={iconBtn}
              aria-label="نسخ الرد"
              onClick={async () => {
                const ok = await copyToClipboard(plainText(message));
                if (ok) toast.success("تم نسخ الرد");
                else toast.error("تعذّر النسخ");
              }}
            >
              <Copy className="h-4 w-4" />
            </button>
            {speech?.supported && (
              <>
                {!speaking ? (
                  <button type="button" className={iconBtn} aria-label="الاستماع إلى الرد" onClick={() => speech.speak(message.id, plainText(message))}>
                    <Volume2 className="h-4 w-4" />
                  </button>
                ) : (
                  <>
                    <button type="button" className={iconBtn} aria-label={speech.paused ? "استئناف القراءة" : "إيقاف القراءة مؤقتاً"} onClick={() => (speech.paused ? speech.resume() : speech.pause())}>
                      {speech.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </button>
                    <button type="button" className={iconBtn} aria-label="إيقاف القراءة" onClick={speech.stop}>
                      <Square className="h-4 w-4" />
                    </button>
                  </>
                )}
                {speaking && speech.hasArabicVoice === false && <span className="text-[11px] text-muted-foreground">لا يتوفر صوت عربي في هذا الجهاز</span>}
              </>
            )}
            {(isLast || message.status === "error" || message.status === "stopped") && (
              <button type="button" className={iconBtn} aria-label="إعادة توليد الرد" onClick={onRetry}>
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
