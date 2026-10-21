import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, FileText, Mic, Paperclip, SendHorizontal, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VoicePanel } from "@/components/assistant/VoicePanel";
import type { ArchiveDocument } from "@/types";

interface ComposerProps {
  onSend: (text: string, via?: "text" | "voice") => void;
  onStop: () => void;
  streaming: boolean;
  draft?: string;
  caseDocuments: ArchiveDocument[];
  caseId?: string;
}

export function Composer({ onSend, onStop, streaming, draft, caseDocuments, caseId }: ComposerProps) {
  const navigate = useNavigate();
  const [text, setText] = useState(draft ?? "");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attached, setAttached] = useState<ArchiveDocument[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft !== undefined) setText(draft);
  }, [draft]);

  // Auto-grow up to ~5 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function submit() {
    const body = text.trim();
    if (!body || streaming) return;
    const refs = attached.length ? `\n[مرفقات: ${attached.map((d) => `${d.title} (${d.caseRef})`).join("، ")}]` : "";
    onSend(body + refs);
    setText("");
    setAttached([]);
  }

  if (voiceOpen) {
    return (
      <VoicePanel
        onClose={() => setVoiceOpen(false)}
        onSend={(t) => onSend(t, "voice")}
      />
    );
  }

  return (
    <div className="space-y-2">
      {attached.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="المرفقات">
          {attached.map((d) => (
            <li key={d.id} className="inline-flex min-h-8 items-center gap-1 rounded-sm border border-border bg-muted px-2 text-xs">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-w-[10rem] truncate">{d.title}</span>
              <button
                type="button"
                aria-label={`إزالة ${d.title}`}
                onClick={() => setAttached((a) => a.filter((x) => x.id !== d.id))}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-secondary"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20"
      >
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="إرفاق وثيقة" className="shrink-0 rounded-full">
              <Paperclip className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-72 max-w-[calc(100vw-1.5rem)]">
            <DropdownMenuLabel>{caseDocuments.length ? "وثائق القضية المحددة" : "اختر قضية لعرض وثائقها"}</DropdownMenuLabel>
            {caseDocuments.map((d) => (
              <DropdownMenuItem
                key={d.id}
                className="min-h-11"
                onSelect={() => setAttached((a) => (a.some((x) => x.id === d.id) ? a : [...a, d]))}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{d.title}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" onSelect={() => navigate(caseId ? `/app/archive/new?case=${caseId}` : "/app/archive/new")}>
              <FilePlus2 className="h-4 w-4" />
              رفع أو تصوير وثيقة جديدة
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <label htmlFor="assistant-input" className="sr-only">
          اكتب رسالتك للمساعد
        </label>
        <textarea
          id="assistant-input"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.("(pointer: fine)").matches) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="اسأل بالدارجة أو بالفصحى…"
          enterKeyHint="send"
          dir="auto"
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 placeholder:text-muted-foreground focus:outline-none md:text-sm"
        />

        {!text.trim() && !streaming && (
          <Button type="button" variant="ghost" size="icon" aria-label="إملاء صوتي" onClick={() => setVoiceOpen(true)} className="shrink-0 rounded-full">
            <Mic className="h-5 w-5" />
          </Button>
        )}
        {streaming ? (
          <Button type="button" size="icon" aria-label="إيقاف التوليد" onClick={onStop} className="shrink-0 rounded-full bg-alert text-alert-foreground hover:bg-alert/90">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="إرسال"
            disabled={!text.trim()}
            className={cn("shrink-0 rounded-full", text.trim() ? "bg-gold text-ink hover:bg-gold-soft" : "")}
          >
            <SendHorizontal className="h-5 w-5 -scale-x-100" />
          </Button>
        )}
      </form>
    </div>
  );
}
