/**
 * Deterministic analysis of OCR text: field extraction, classification, duplicate detection and
 * case matching. Every suggestion carries a confidence and human-readable evidence; nothing here
 * changes data — results are proposals that a human verifies.
 */
import type {
  ArchiveCategory,
  ArchiveDocument,
  ArchiveItem,
  CaseSuggestion,
  DuplicateMatch,
  ExtractedField,
  LegalCase,
} from "@/types";
import { normalizeText, tokenize, toLatinDigits } from "@/lib/arabic";
import { arabicMonths } from "@/lib/formatters";
import { CATEGORY_LABELS } from "@/services/archive/workflow";

export interface PageInput {
  text: string;
  confidence: number;
  uncertain: string[];
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function spanConfidence(span: string, page: PageInput, strength: number): number {
  const shaky = page.uncertain.some((w) => w.length > 1 && span.includes(w));
  return clamp(page.confidence * strength * (shaky ? 0.6 : 1));
}

// ——— Dates ———

const AR_MONTHS: [string, number][] = [
  ...arabicMonths.map((m, i) => [m, i] as [string, number]),
  ["يناير", 0], ["فبراير", 1], ["أبريل", 3], ["ابريل", 3], ["مايو", 4], ["يونيو", 5], ["يوليو", 6], ["أغسطس", 7], ["اوت", 7],
];
const FR_MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

function iso(y: number, m: number, d: number): string | null {
  if (y < 1950 || y > new Date().getFullYear() + 1 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const date = new Date(y, m, d);
  if (date.getMonth() !== m) return null;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function findDates(text: string): { iso: string; raw: string; anchored: boolean }[] {
  const t = toLatinDigits(text);
  const out: { iso: string; raw: string; anchored: boolean; index: number }[] = [];
  const push = (value: string | null, raw: string, index: number) => {
    if (!value) return;
    const before = t.slice(Math.max(0, index - 12), index);
    out.push({ iso: value, raw, anchored: /(بتاريخ|في|يوم|le|du|en date du)\s*$/i.test(before), index });
  };
  const arPattern = new RegExp(`(\\d{1,2})\\s+(${AR_MONTHS.map(([m]) => m).join("|")})\\s+(\\d{4})`, "g");
  for (const m of t.matchAll(arPattern)) push(iso(+m[3], AR_MONTHS.find(([n]) => n === m[2])![1], +m[1]), m[0], m.index ?? 0);
  const plain = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const m of plain.matchAll(/(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/gi)) {
    push(iso(+m[3], FR_MONTHS.indexOf(m[2].toLowerCase()), +m[1]), m[0], m.index ?? 0);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) push(iso(+m[3], +m[2] - 1, +m[1]), m[0], m.index ?? 0);
  return out.sort((a, b) => Number(b.anchored) - Number(a.anchored) || a.index - b.index);
}

// ——— Field extraction ———

const COURT_PATTERNS = [
  /محكمة\s+(?:التعقيب|الاستئناف(?:\s+ب[؀-ۿ]+)?|الناحية(?:\s+ب[؀-ۿ]+)?)/,
  /المحكمة\s+(?:الابتدائية|العقارية)(?:\s+ب[؀-ۿ]+)?/,
  /(?:Cour de cassation|Cour d['’]appel(?: de [A-Z][\w-]+)?|Tribunal de premi[eè]re instance(?: de [A-Z][\w-]+)?|Tribunal immobilier)/i,
];

const PARTY_MARKERS = /(?:في حق|لفائدة|ضد|المدعي|المدعى عليه|الطاعنون|الطاعن|المطعون ضده|بين)[ \t]*[:：]?[ \t]*((?:[؀-ۿ]+[ \t]?){1,4})/g;
const PARTY_STOP = new Set(["و", "في", "من", "على", "الى", "إلى", "عدد", "بتاريخ", "حيث", "وحيث", "المحكمة", "القضية", "ورثة", "المرحوم"]);

export function extractFields(pages: PageInput[], cases: LegalCase[]): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const firstMatch = (rx: RegExp) => {
    for (let i = 0; i < pages.length; i++) {
      const m = toLatinDigits(pages[i].text).match(rx);
      if (m) return { m, page: i };
    }
    return null;
  };

  // Case reference
  const refPatterns: [RegExp, number, (m: RegExpMatchArray) => string][] = [
    [/\b([A-Z]{2})\s*\/\s*(\d{4})\s*\/\s*(\d{3,5})\b/, 1, (m) => `${m[1]}/${m[2]}/${m[3]}`],
    [/(?:القضية|قضية|الملف)\s*(?:عدد|رقم)\s*[:：]?\s*(\d{3,6}(?:\s*\/\s*\d{2,4})?)/, 0.9, (m) => m[1].replace(/\s+/g, "")],
    [/affaire\s*n[°o]\s*([\d/]+)/i, 0.9, (m) => m[1]],
  ];
  for (const [rx, strength, fmt] of refPatterns) {
    const hit = firstMatch(rx);
    if (hit) {
      fields.push({ key: "caseRef", label: "مرجع القضية", value: fmt(hit.m), confidence: spanConfidence(hit.m[0], pages[hit.page], strength), source: "rule", evidence: hit.m[0], page: hit.page + 1 });
      break;
    }
  }

  // Date
  for (let i = 0; i < pages.length; i++) {
    const dates = findDates(pages[i].text);
    if (dates.length) {
      const d = dates[0];
      fields.push({ key: "date", label: "التاريخ", value: d.iso, confidence: spanConfidence(d.raw, pages[i], d.anchored ? 1 : 0.8), source: "rule", evidence: d.raw, page: i + 1 });
      break;
    }
  }

  // Court
  for (const rx of COURT_PATTERNS) {
    const hit = firstMatch(rx);
    if (hit) {
      fields.push({ key: "court", label: "المحكمة", value: hit.m[0].trim(), confidence: spanConfidence(hit.m[0], pages[hit.page], 0.95), source: "rule", evidence: hit.m[0], page: hit.page + 1 });
      break;
    }
  }

  // Parties
  const parties = new Set<string>();
  let partyPage = 0;
  let partySpan = "";
  pages.forEach((p, i) => {
    for (const m of p.text.matchAll(PARTY_MARKERS)) {
      const name = m[1].split(/\s+/).filter((w) => w && !PARTY_STOP.has(w)).slice(0, 3).join(" ");
      if (name.length >= 3) {
        if (!parties.size) {
          partyPage = i;
          partySpan = m[0];
        }
        parties.add(name);
      }
    }
    // Names never span a line break (OCR lines are separate visual lines).
    for (const m of p.text.matchAll(/(?:M\.|Mme|Monsieur|Madame)[ \t]+([A-Z][\w'-]+(?:[ \t]+[A-Z][\w'-]+){0,2})/g)) parties.add(m[1]);
  });
  if (parties.size) {
    fields.push({ key: "parties", label: "الأطراف", value: [...parties].slice(0, 4).join("، "), confidence: spanConfidence(partySpan, pages[partyPage], 0.7), source: "rule", evidence: partySpan, page: partyPage + 1 });
  }

  // Known client
  const all = normalizeText(pages.map((p) => p.text).join(" "));
  const client = cases
    .map((c) => {
      const full = normalizeText(c.client);
      const tokens = full.split(" ").filter((t) => t.length >= 4 && !["عايله", "شركه", "ورثه", "للتجاره"].includes(t));
      return { c, score: all.includes(full) ? 0.95 : tokens.some((t) => all.includes(t)) ? 0.7 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (client) {
    fields.push({ key: "client", label: "الحريف", value: client.c.client, confidence: clamp((pages[0]?.confidence ?? 70) * client.score), source: "rule", evidence: client.c.client });
  }

  // Title: first meaningful line, skipping standard letterhead lines and bidi control marks.
  const BOILERPLATE = /^(الجمهورية التونسية|وزارة العدل|باسم الشعب التونسي|République tunisienne|Ministère de la justice)$/i;
  const firstLine = pages[0]?.text
    .split(/\n+/)
    .map((l) => l.replace(/[‎‏‪-‮]/g, "").trim())
    .find((l) => l.length >= 4 && l.length <= 90 && !BOILERPLATE.test(l));
  if (firstLine) {
    fields.push({ key: "title", label: "عنوان الوثيقة", value: firstLine, confidence: spanConfidence(firstLine, pages[0], 0.6), source: "rule", page: 1 });
  }
  return fields;
}

// ——— Classification ———

const CATEGORY_KEYWORDS: Record<Exclude<ArchiveCategory, "other">, [string, number][]> = {
  judgment: [["حكمت المحكمة", 3], ["لهذه الأسباب", 3], ["قضت", 2], ["حكم", 1.5], ["قرار", 1], ["jugement", 2], ["arrêt", 2], ["par ces motifs", 3]],
  petition: [["عريضة", 3], ["المطاعن", 2], ["الطاعن", 1.5], ["يطلب", 1], ["requête", 3], ["demande", 1]],
  minutes: [["محضر", 3], ["حضر", 1.5], ["جلسة", 1], ["procès-verbal", 3], ["audience", 1]],
  contract: [["عقد", 2.5], ["الطرف الأول", 2], ["الطرف الثاني", 2], ["contrat", 3], ["les parties", 1.5]],
  correspondence: [["تحية طيبة", 2], ["المحترم", 1.5], ["إلى السيد", 1.5], ["إلى الأستاذ", 1.5], ["monsieur", 1], ["objet", 1.5], ["veuillez", 1.5]],
  power_of_attorney: [["توكيل", 3], ["وكالة", 2.5], ["الموكل", 2], ["procuration", 3], ["mandat", 2]],
  financial: [["فاتورة", 3], ["وصل", 2], ["مبلغ", 1.5], ["دينار", 1.5], ["الأتعاب", 1.5], ["facture", 3], ["montant", 2]],
};

export function classify(text: string): { suggested: ArchiveCategory; confidence: number; evidence: string[] } {
  const n = normalizeText(text);
  const scores = (Object.keys(CATEGORY_KEYWORDS) as Exclude<ArchiveCategory, "other">[]).map((cat) => {
    const evidence: string[] = [];
    let score = 0;
    for (const [kw, weight] of CATEGORY_KEYWORDS[cat]) {
      const k = normalizeText(kw);
      const count = k ? n.split(k).length - 1 : 0;
      if (count) {
        score += weight * Math.min(count, 3);
        evidence.push(`«${kw}»${count > 1 ? ` ×${count}` : ""}`);
      }
    }
    return { cat, score, evidence };
  });
  scores.sort((a, b) => b.score - a.score);
  const [top, second] = scores;
  if (!top || top.score < 2) {
    return { suggested: "other", confidence: 35, evidence: ["لم تُرصد مؤشرات كافية لتصنيف محدد"] };
  }
  const confidence = clamp((top.score / (top.score + (second?.score ?? 0) + 2)) * 100 + 15);
  return { suggested: top.cat, confidence, evidence: [`مؤشرات «${CATEGORY_LABELS[top.cat]}»:`, ...top.evidence.slice(0, 4)] };
}

// ——— Duplicates ———

function shingles(text: string): Set<string> {
  const t = tokenize(text);
  const set = new Set<string>();
  for (let i = 0; i + 2 < t.length; i++) set.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
  return set;
}

export function textSimilarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size < 6 || B.size < 6) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

export function itemText(item: ArchiveItem): string {
  return item.pages.map((p) => p.correctedText ?? p.ocr?.text ?? "").join("\n");
}

const fieldValue = (fields: ExtractedField[], key: ExtractedField["key"]) => fields.find((f) => f.key === key)?.value;

export function findDuplicates(item: ArchiveItem, others: ArchiveItem[], documents: ArchiveDocument[]): DuplicateMatch[] {
  const text = itemText(item);
  const ref = fieldValue(item.fields, "caseRef");
  const date = fieldValue(item.fields, "date");
  const matches: DuplicateMatch[] = [];
  const previous = new Map(item.duplicates.map((d) => [d.targetId, d.decision]));

  for (const other of others) {
    if (other.id === item.id) continue;
    const evidence: string[] = [];
    let score = 0;
    let kind: DuplicateMatch["kind"] = "probable";
    if (item.sha256 && other.sha256 === item.sha256) {
      score = 1;
      kind = "exact";
      evidence.push("البصمة الرقمية SHA-256 للملف متطابقة");
    }
    const sim = textSimilarity(text, itemText(other));
    if (sim >= 0.5) {
      score = Math.max(score, sim);
      evidence.push(`تشابه النص المستخرج ${Math.round(sim * 100)}%`);
    }
    if (ref && date && fieldValue(other.fields, "caseRef") === ref && fieldValue(other.fields, "date") === date) {
      score = Math.max(score, 0.7);
      evidence.push(`نفس المرجع (${ref}) ونفس التاريخ (${date})`);
    }
    if (score > 0) matches.push({ targetType: "item", targetId: other.id, targetLabel: other.fileName, kind, score, evidence, decision: previous.get(other.id) });
  }

  for (const doc of documents) {
    const evidence: string[] = [];
    let score = 0;
    let kind: DuplicateMatch["kind"] = "probable";
    if (item.sha256 && doc.verified?.sha256 === item.sha256) {
      score = 1;
      kind = "exact";
      evidence.push("البصمة الرقمية مطابقة لوثيقة مؤرشفة");
    }
    const sim = textSimilarity(text, doc.pages.map((p) => p.text).join("\n"));
    if (sim >= 0.5) {
      score = Math.max(score, sim);
      evidence.push(`تشابه النص مع وثيقة مؤرشفة ${Math.round(sim * 100)}%`);
    }
    if (ref && doc.caseRef === ref && date && doc.date === date) {
      score = Math.max(score, 0.7);
      evidence.push("نفس المرجع ونفس التاريخ لوثيقة مؤرشفة");
    }
    if (score > 0) matches.push({ targetType: "document", targetId: doc.id, targetLabel: `${doc.title} — ${doc.caseRef}`, kind, score, evidence, decision: previous.get(doc.id) });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ——— Case matching ———

const TYPE_HINTS: Record<string, RegExp> = {
  "نزاع ميراث": /(ميراث|تركه|ورثه|اراثه)/,
  "قضية مدنية": /(تعويض|مدني|حساب)/,
  "طعن تعقيبي": /(تعقيب|طعن)/,
  "قضية تجارية": /(تجاري|توريد|شركه)/,
  "قضية عقارية": /(عقار|حدود|رسم عقاري)/,
};

export function matchCases(item: ArchiveItem, cases: LegalCase[]): CaseSuggestion[] {
  const text = normalizeText(itemText(item));
  const ref = fieldValue(item.fields, "caseRef");
  const parties = normalizeText(fieldValue(item.fields, "parties") ?? "");
  const out: CaseSuggestion[] = [];
  for (const c of cases) {
    let score = 0;
    const evidence: string[] = [];
    if (ref && ref === c.ref) {
      score += 0.9;
      evidence.push(`المرجع المستخرج ${ref} مطابق لمرجع الملف`);
    } else if (ref && ref.split("/").pop() === c.ref.split("/").pop()) {
      score += 0.25;
      evidence.push(`نفس الرقم التسلسلي لمرجع آخر (${ref})`);
    }
    const full = normalizeText(c.client);
    const tokens = full.split(" ").filter((t) => t.length >= 4 && !["عايله", "شركه", "ورثه", "للتجاره"].includes(t));
    if (text.includes(full)) {
      score += 0.5;
      evidence.push(`اسم الحريف «${c.client}» مذكور في الوثيقة`);
    } else if (tokens.some((t) => text.includes(t))) {
      score += 0.3;
      evidence.push(`جزء من اسم الحريف مذكور (${tokens.filter((t) => text.includes(t)).join("، ")})`);
    }
    if (parties && tokens.some((t) => parties.includes(t))) {
      score += 0.15;
      evidence.push("الاسم وارد ضمن الأطراف المستخرجة");
    }
    if (TYPE_HINTS[c.type]?.test(text)) {
      score += 0.1;
      evidence.push(`موضوع الوثيقة يتقاطع مع نوع الملف (${c.type})`);
    }
    if (score >= 0.3) out.push({ caseId: c.id, score: Math.min(1, Math.round(score * 100) / 100), evidence });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function confidenceLabel(score01: number): { label: string; tone: "success" | "gold" | "neutral" } {
  if (score01 >= 0.75) return { label: "ثقة مرتفعة", tone: "success" };
  if (score01 >= 0.45) return { label: "ثقة متوسطة", tone: "gold" };
  return { label: "ثقة ضعيفة", tone: "neutral" };
}
