/**
 * Archive shortcuts for the legal assistant. Deterministic, read-only, and always presented as
 * suggestions: quotes are verbatim with page citations, nothing is approved or applied automatically.
 */
import type { ArchiveBatch, ArchiveItem, Citation } from "@/types";
import type { AssistantBlock } from "@/services/assistant/types";
import { getDB } from "@/services/db";
import { tokenize } from "@/lib/arabic";
import { findDates, matchCases, confidenceLabel } from "@/services/archive/analysis";
import { accessibleCasesForMatching } from "@/services/archive/service";
import { detectInjection, searchDocuments, citationFor, stripInstructionLikeSentences } from "@/services/retrieval";
import { CATEGORY_LABELS, LOW_CONFIDENCE, STATE_LABELS } from "@/services/archive/workflow";

const SUGGESTION = "اقتراح آلي — لا يُعتمد إلا بقرار بشري";

function pageCitation(item: ArchiveItem, pageIndex: number, excerpt: string): Citation {
  return {
    documentId: item.id,
    title: item.fileName,
    page: pageIndex + 1,
    excerpt,
    href: `/app/archive/batches/${item.batchId}/review/${item.id}?page=${pageIndex + 1}`,
  };
}

const pageText = (item: ArchiveItem) =>
  [...item.pages].sort((a, b) => a.index - b.index).map((p) => p.correctedText ?? p.ocr?.text ?? "");

export function summarizeItem(item: ArchiveItem): AssistantBlock[] {
  const texts = pageText(item);
  if (!texts.some((t) => t.trim())) return [{ type: "notice", tone: "warning", text: "لا يوجد نص مستخرج لهذه الوثيقة بعد؛ لا يمكن تلخيصها." }];
  const citations: Citation[] = [];
  let dropped = 0;
  texts.forEach((t, i) => {
    const { clean, removed } = stripInstructionLikeSentences(t);
    dropped += removed;
    clean
      .split(/\n+|(?<=[.!؟])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25)
      .slice(0, i === 0 ? 3 : 1)
      .forEach((s) => citations.push(pageCitation(item, i, s.length > 220 ? `${s.slice(0, 217)}…` : s)));
  });
  const blocks: AssistantBlock[] = [
    { type: "text", text: "أبرز ما ورد في الوثيقة (اقتباسات حرفية من النص المستخرج، دون أي استنتاج قانوني):" },
    { type: "sources", title: "مقتطفات مع رقم الصفحة", citations },
  ];
  if (dropped) blocks.push({ type: "notice", tone: "danger", text: "تحتوي الوثيقة على عبارات تشبه تعليمات لنظام آلي: استُبعدت من الملخص وعوملت كنص غير موثوق." });
  return blocks;
}

export function similarDocuments(item: ArchiveItem): AssistantBlock[] {
  const freq = new Map<string, number>();
  for (const t of tokenize(pageText(item).join(" "))) if (t.length > 3 && !/^\d+$/.test(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const terms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  if (!terms.length) return [{ type: "notice", tone: "warning", text: "لا يوجد نص كافٍ للبحث عن وثائق مشابهة." }];
  const hits = searchDocuments(terms.join(" "), { scope: "all" }).hits.slice(0, 4);
  const blocks: AssistantBlock[] = [];
  if (item.duplicates.length) {
    blocks.push({
      type: "list",
      title: "تكرارات محتملة داخل الأرشيف والدفعات",
      items: item.duplicates.map((d) => ({ id: d.targetId, title: d.targetLabel, meta: d.evidence.join(" • "), badge: { label: d.kind === "exact" ? "مطابقة تامة" : `${Math.round(d.score * 100)}%`, tone: d.kind === "exact" ? "alert" : "gold" } })),
    });
  }
  blocks.push(
    hits.length
      ? { type: "sources", title: `وثائق مؤرشفة مشابهة (بحث بالمصطلحات: ${terms.join("، ")})`, citations: hits.map((h) => citationFor(h)) }
      : { type: "notice", tone: "info", text: "لم أجد وثائق مؤرشفة مشابهة ضمن ما يحق لك الاطلاع عليه." },
  );
  return blocks;
}

export function suggestCase(item: ArchiveItem): AssistantBlock[] {
  const suggestions = matchCases(item, accessibleCasesForMatching());
  if (!suggestions.length) {
    return [{ type: "notice", tone: "info", text: "لم أجد قضية مطابقة بثقة كافية. لا تُنشأ أي قضية أو ربط دون قرار بشري." }];
  }
  const db = getDB();
  return [
    {
      type: "list",
      title: `القضايا المقترحة (${SUGGESTION})`,
      items: suggestions.map((s) => {
        const c = db.cases.find((x) => x.id === s.caseId)!;
        const conf = confidenceLabel(s.score);
        return { id: s.caseId, title: `${c.client} — ${c.ref}`, subtitle: c.type, meta: s.evidence.join(" • "), href: `/app/cases/${c.id}`, badge: { label: conf.label, tone: conf.tone } };
      }),
    },
    { type: "notice", tone: "info", text: "اعتمد الاقتراح من تبويب «القضية»؛ الربط الفعلي يتم فقط بعد الموافقة والحفظ النهائي." },
  ];
}

export function checkExtraction(item: ArchiveItem): AssistantBlock[] {
  const issues: string[] = [];
  const now = new Date();
  const cases = accessibleCasesForMatching();
  for (const f of item.fields) {
    if (f.source !== "human" && f.confidence < LOW_CONFIDENCE) issues.push(`«${f.label}» بثقة منخفضة (${f.confidence}%): تحقّق منه مقارنة بالصورة.`);
    if (f.key === "date") {
      const d = new Date(f.value);
      if (d > now) issues.push(`التاريخ ${f.value} في المستقبل — يرجّح خطأ في القراءة.`);
      const ref = item.fields.find((x) => x.key === "caseRef")?.value;
      const refYear = ref?.match(/\b(19|20)\d{2}\b/)?.[0];
      if (refYear && Math.abs(Number(refYear) - d.getFullYear()) > 3) issues.push(`سنة المرجع (${refYear}) بعيدة عن سنة التاريخ (${d.getFullYear()}).`);
    }
    if (f.key === "caseRef" && /^[A-Z]{2}\//.test(f.value) && !cases.some((c) => c.ref === f.value)) {
      issues.push(`المرجع ${f.value} لا يطابق أي ملف جارٍ (قد يكون ملفاً قديماً أو خطأ قراءة).`);
    }
  }
  for (const key of ["date", "caseRef", "court"] as const) {
    if (!item.fields.some((f) => f.key === key)) issues.push(`لم يُستخرج «${{ date: "التاريخ", caseRef: "مرجع القضية", court: "المحكمة" }[key]}»: أدخله يدوياً إن وُجد.`);
  }
  const alt = pageText(item).flatMap((t) => findDates(t)).map((d) => d.iso);
  if (new Set(alt).size > 1) issues.push(`وردت عدة تواريخ في النص (${[...new Set(alt)].slice(0, 4).join("، ")}): تأكد من اختيار تاريخ الوثيقة الصحيح.`);
  if (item.missingPages?.length) issues.push(`ترقيم الصفحات يشير إلى صفحات ناقصة: ${item.missingPages.join("، ")}.`);
  item.pages.forEach((p) => {
    if (p.quality.blank) issues.push(`الصفحة ${p.index + 1} تبدو فارغة.`);
    else if (p.quality.blurry) issues.push(`الصفحة ${p.index + 1} قد تكون ضبابية؛ أعد تصويرها إن كان النص غير مقروء.`);
  });
  if (item.pages.some((p) => p.ocr && detectInjection(p.ocr.text))) issues.push("رُصدت عبارات تشبه تعليمات لنظام آلي داخل النص: تُعامل كنص غير موثوق.");
  return issues.length
    ? [{ type: "suggestions", title: `ملاحظات على البيانات المستخرجة (${SUGGESTION})`, items: issues }]
    : [{ type: "notice", tone: "info", text: "لم أرصد تناقضات واضحة. المراجعة البشرية تبقى ضرورية قبل الاعتماد." }];
}

export function lawyerBriefing(batch: ArchiveBatch, items: ArchiveItem[]): AssistantBlock[] {
  const db = getDB();
  const count = (s: ArchiveItem["state"]) => items.filter((i) => i.state === s).length;
  const lines = items.map((i) => {
    const cat = i.classification ? CATEGORY_LABELS[i.classification.final ?? i.classification.suggested] : "غير مصنّفة";
    const c = i.caseMatch.caseId ? db.cases.find((x) => x.id === i.caseMatch.caseId) : undefined;
    const flags = [
      i.fields.some((f) => f.source !== "human" && f.confidence < LOW_CONFIDENCE) && "حقول غير مؤكدة",
      i.duplicates.some((d) => !d.decision) && "تكرار محتمل",
      i.missingPages?.length && "صفحات ناقصة",
      i.excluded && "مستبعدة",
    ].filter(Boolean);
    return {
      id: i.id,
      title: i.fileName,
      subtitle: `${cat}${c ? ` — ${c.client}` : ""}`,
      meta: `${STATE_LABELS[i.state]}${flags.length ? ` • ${flags.join("، ")}` : ""}`,
      href: `/app/archive/batches/${batch.id}/review/${i.id}`,
    };
  });
  return [
    {
      type: "text",
      text: `ملخص الدفعة ${batch.reference} «${batch.name}» للمراجعة: ${items.length} وثائق — ${count("review")} في انتظار المراجعة، ${count("pending_approval")} في انتظار الموافقة، ${count("ready")} جاهزة، ${count("archived")} مؤرشفة، ${count("needs_correction") + count("failed")} تحتاج تدخلاً.${batch.expectedCount && items.length < batch.expectedCount ? ` العدد المتوقع ${batch.expectedCount}: قد تكون هناك وثائق لم تُرفع.` : ""}`,
    },
    { type: "list", title: "الوثائق ونقاط الانتباه", items: lines },
    { type: "notice", tone: "warning", text: "هذا ملخص تحضيري آلي؛ قرارات الاعتماد والربط والحفظ تبقى للمحامي المخوّل." },
  ];
}
