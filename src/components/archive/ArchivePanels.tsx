import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Copy, FileSearch, Link2, ListChecks, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MessageBlock } from "@/components/assistant/MessageBlocks";
import { useDB } from "@/hooks/use-db";
import { confidenceLabel } from "@/services/archive/analysis";
import { accessibleCasesForMatching, setCaseDecision, setDuplicateDecision, setExcluded } from "@/services/archive/service";
import { checkExtraction, lawyerBriefing, similarDocuments, suggestCase, summarizeItem } from "@/services/archive/assistant";
import type { AssistantBlock } from "@/services/assistant/types";
import type { ArchiveBatch, ArchiveItem } from "@/types";

const DECISION_LABELS: Record<ArchiveItem["caseMatch"]["decision"], string> = {
  pending: "لم يُحسم بعد",
  approved: "اقتراح معتمد — يُنفّذ عند الموافقة والحفظ",
  rejected: "مرفوض — بدون ربط",
  deferred: "مؤجّل",
};

export function CaseMatchPanel({ item, readOnly }: { item: ArchiveItem; readOnly?: boolean }) {
  const db = useDB();
  const cases = accessibleCasesForMatching(db);
  const [other, setOther] = useState<string>("");
  const decide = (decision: ArchiveItem["caseMatch"]["decision"], caseId?: string) => {
    const r = setCaseDecision(item.id, item.version, decision, caseId);
    if (!r.ok) toast.error(r.error);
  };
  const chosen = cases.find((c) => c.id === item.caseMatch.caseId);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        القرار الحالي: <span className="font-medium text-foreground">{DECISION_LABELS[item.caseMatch.decision]}</span>
        {chosen && ` — ${chosen.client} (${chosen.ref})`}
      </p>
      {item.caseMatch.suggestions.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-border p-3 text-sm text-muted-foreground">لم يُعثر على قضية مطابقة بثقة كافية. يمكنك اختيار قضية يدوياً أو ترك الوثيقة بدون ربط.</p>
      ) : (
        <ul className="space-y-2">
          {item.caseMatch.suggestions.map((s) => {
            const c = db.cases.find((x) => x.id === s.caseId);
            if (!c) return null;
            const conf = confidenceLabel(s.score);
            const selected = item.caseMatch.caseId === c.id && item.caseMatch.decision === "approved";
            return (
              <li key={s.caseId} className={cn("space-y-2 rounded-[var(--radius)] border p-3", selected ? "border-success/50 bg-success/5" : "border-border")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/app/cases/${c.id}`} className="inline-flex items-center font-medium underline-offset-2 hover:underline coarse:min-h-11">
                      {c.client}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      <span className="ref-tag ml-1">{c.ref}</span> {c.type}
                    </p>
                  </div>
                  <StatusBadge label={`${conf.label} (${Math.round(s.score * 100)}%)`} tone={conf.tone} />
                </div>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {s.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                {!readOnly && !selected && (
                  <Button size="sm" variant="outline" onClick={() => decide("approved", c.id)}>
                    <Link2 className="h-4 w-4" />
                    اعتماد هذا الاقتراح
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
          <p className="text-xs font-medium">تغيير القضية يدوياً</p>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <Select value={other} onValueChange={setOther}>
                <SelectTrigger aria-label="اختيار قضية أخرى">
                  <SelectValue placeholder="اختر قضية" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.client} — {c.ref}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" disabled={!other} onClick={() => decide("approved", other)}>
              اعتماد
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="ghost" onClick={() => decide("rejected")}>
              رفض الربط
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide("deferred", item.caseMatch.caseId)}>
              تأجيل القرار
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">لا يُنشأ أي ربط فعلي ولا أي قضية جديدة قبل الموافقة والحفظ النهائي.</p>
        </div>
      )}
    </div>
  );
}

export function DuplicatesPanel({ item, readOnly }: { item: ArchiveItem; readOnly?: boolean }) {
  const decide = (targetId: string, decision: "duplicate" | "not_duplicate") => {
    const r = setDuplicateDecision(item.id, targetId, decision);
    if (!r.ok) toast.error(r.error);
  };
  return (
    <div className="space-y-3">
      {item.excluded && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
          <span>{item.excluded.reason}</span>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => setExcluded(item.id, false)}>
              إعادة الإدراج
            </Button>
          )}
        </div>
      )}
      {item.duplicates.length === 0 ? (
        <p className="text-sm text-muted-foreground">لم تُرصد نسخ مكررة (مقارنة البصمة الرقمية والنص والبيانات).</p>
      ) : (
        <ul className="space-y-2">
          {item.duplicates.map((d) => (
            <li key={d.targetId} className="space-y-2 rounded-[var(--radius)] border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{d.targetLabel}</span>
                </span>
                <StatusBadge label={d.kind === "exact" ? "مطابقة تامة" : `تشابه ${Math.round(d.score * 100)}%`} tone={d.kind === "exact" ? "alert" : "gold"} />
              </div>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {d.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {d.decision ? (
                <p className="text-xs">{d.decision === "duplicate" ? "تم تأكيد التكرار — مستبعدة (الأصل محفوظ ولم يُحذف)" : "تم تأكيد أنها ليست نسخة مكررة"}</p>
              ) : (
                !readOnly && (
                  <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
                    <Button size="sm" variant="outline" onClick={() => decide(d.targetId, "not_duplicate")}>
                      ليست نسخة مكررة
                    </Button>
                    <Button size="sm" variant="outline" className="text-alert" onClick={() => decide(d.targetId, "duplicate")}>
                      مكررة — استبعاد من الأرشفة
                    </Button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">لا يتم حذف أو دمج أو استبدال أي وثيقة آلياً.</p>
    </div>
  );
}

type ShortcutKey = "summary" | "similar" | "case" | "check" | "lawyer";
const SHORTCUTS: { key: ShortcutKey; label: string; icon: typeof Bot }[] = [
  { key: "summary", label: "لخص هذه الوثيقة", icon: ScrollText },
  { key: "similar", label: "ابحث عن وثائق مشابهة", icon: FileSearch },
  { key: "case", label: "اقترح القضية المناسبة", icon: Link2 },
  { key: "check", label: "تحقق من البيانات المستخرجة", icon: ListChecks },
  { key: "lawyer", label: "حضّر ملخصاً للمحامي", icon: Bot },
];

export function AssistantShortcuts({ item, batch, items }: { item?: ArchiveItem; batch: ArchiveBatch; items: ArchiveItem[] }) {
  const [active, setActive] = useState<ShortcutKey | null>(null);
  const [blocks, setBlocks] = useState<AssistantBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const run = (key: ShortcutKey) => {
    setActive(key);
    setBusy(true);
    // Deterministic and local; the short delay only keeps the interaction legible.
    setTimeout(() => {
      setBlocks(
        key === "lawyer" ? lawyerBriefing(batch, items) : !item ? [] : key === "summary" ? summarizeItem(item) : key === "similar" ? similarDocuments(item) : key === "case" ? suggestCase(item) : checkExtraction(item),
      );
      setBusy(false);
    }, 150);
  };
  const available = SHORTCUTS.filter((s) => item || s.key === "lawyer");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="اختصارات المساعد">
        {available.map((s) => (
          <Button key={s.key} size="sm" variant={active === s.key ? "secondary" : "outline"} onClick={() => run(s.key)}>
            <s.icon className="h-4 w-4 text-gold-deep" />
            {s.label}
          </Button>
        ))}
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ التحليل...
        </p>
      )}
      {!busy && active && (
        <div className="space-y-3 rounded-[var(--radius)] border border-border bg-card p-3" aria-live="polite">
          <p className="flex items-center gap-1.5 text-[11px] text-gold-deep">
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            المساعد يقترح فقط ولا يعتمد أي تغيير — كل قرار يبقى بشرياً.
          </p>
          {blocks.map((b, i) => (
            <MessageBlock key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  );
}
