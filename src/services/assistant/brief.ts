/**
 * Hearing preparation brief generator (demo engine).
 *
 * Grounding rules enforced here:
 *  - Retrieved statements are quoted verbatim with document/page citations (kind "source").
 *  - Anything composed by the engine is marked "generated" and must be reviewed by a lawyer.
 *  - No legislation article numbers or case-law citations are ever produced; codes merely
 *    *mentioned* in the file are listed under "references to verify".
 *  - Instruction-like sentences inside documents are dropped and reported (prompt-injection guard).
 */
import type { ArchiveDocument, Brief, BriefItem, BriefSection, Citation, Hearing, LegalCase, TeamMember } from "@/types";
import { EXPECTED_DOCUMENTS } from "@/data/mock";
import { normalizeText } from "@/lib/arabic";
import { formatArabicDate } from "@/lib/formatters";
import { getDB, newId, type DemoDatabase } from "@/services/db";
import { currentUser, documentsForCase, findAccessibleCase, hearingsForCase, nextHearingForCase } from "@/services/api";
import { detectInjection, searchDocuments } from "@/services/retrieval";

export const BRIEF_SECTIONS: { key: string; title: string }[] = [
  { key: "file", title: "ملف القضية" },
  { key: "facts", title: "الوقائع الأساسية" },
  { key: "timeline", title: "التسلسل الزمني" },
  { key: "legal", title: "النقاط القانونية" },
  { key: "arguments", title: "الحجج الممكنة" },
  { key: "counter", title: "الحجج المضادة المتوقعة" },
  { key: "weaknesses", title: "نقاط الضعف" },
  { key: "missing", title: "الوثائق الناقصة" },
  { key: "questions", title: "أسئلة للمرافعة" },
  { key: "verify", title: "مراجع تحتاج إلى التحقق" },
];

/** Documents authored by the firm (our side) vs. court or opposing-party material. */
const OWN_DOC_TYPES = ["عريضة الطعن", "مذكرة دفاع", "عريضة الدعوى"];

const KNOWN_CODES = [
  "مجلة الأحوال الشخصية",
  "مجلة الالتزامات والعقود",
  "مجلة المرافعات المدنية والتجارية",
  "مجلة الحقوق العينية",
  "المجلة التجارية",
];

interface Sentence {
  text: string;
  doc: ArchiveDocument;
  page: number;
}

function sentencesOf(doc: ArchiveDocument): { kept: Sentence[]; dropped: number } {
  const kept: Sentence[] = [];
  let dropped = 0;
  for (const page of doc.pages) {
    for (const raw of page.text.split(/\n+|(?<=[.!؟])\s+/)) {
      const text = raw.trim();
      if (text.length < 12) continue;
      if (detectInjection(text)) {
        dropped++;
        continue;
      }
      kept.push({ text, doc, page: page.number });
    }
  }
  return { kept, dropped };
}

function cite(s: Sentence): Citation {
  return {
    documentId: s.doc.id,
    title: `${s.doc.title} — ${s.doc.caseRef}`,
    page: s.page,
    caseId: s.doc.caseId,
    excerpt: s.text.length > 160 ? `${s.text.slice(0, 157)}…` : s.text,
    term: s.text.split(/\s+/).slice(1, 3).join(" "),
  };
}

const item = (kind: BriefItem["kind"], text: string, citations: Citation[] = []): BriefItem => ({
  id: newId("bi"),
  kind,
  text,
  citations,
});

const has = (sentences: Sentence[], rx: RegExp) => sentences.filter((s) => rx.test(normalizeText(s.text)));

export interface BriefGeneration {
  brief: Brief;
  citations: Citation[];
  droppedInstructions: number;
  missingCount: number;
  hearing?: Hearing;
}

export function generateBrief(
  caseId: string,
  options: { hearingId?: string; now?: Date } = {},
  db: DemoDatabase = getDB(),
  user: TeamMember = currentUser(db),
): BriefGeneration | null {
  const legalCase = findAccessibleCase(caseId, db, user);
  if (!legalCase) return null;
  const now = options.now ?? new Date();
  const hearing =
    hearingsForCase(caseId, db, user).find((h) => h.id === options.hearingId) ?? nextHearingForCase(caseId, now, db, user);
  const docs = documentsForCase(caseId, db, user);
  const own = docs.filter((d) => OWN_DOC_TYPES.includes(d.docType));
  const others = docs.filter((d) => !OWN_DOC_TYPES.includes(d.docType));

  let dropped = 0;
  const collect = (list: ArchiveDocument[]) =>
    list.flatMap((d) => {
      const r = sentencesOf(d);
      dropped += r.dropped;
      return r.kept;
    });
  const ownSentences = collect(own);
  const otherSentences = collect(others);
  const all = [...ownSentences, ...otherSentences];

  const sections: Record<string, BriefItem[]> = Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.key, []]));

  // 1. Case file (from the case record).
  sections.file.push(
    item("source", `المرجع ${legalCase.ref} — ${legalCase.type} — ${legalCase.court}.`),
    item("source", `الحريف: ${legalCase.client}. الحالة: ${legalCase.status}. المحامي المكلّف: ${legalCase.assignedLawyer}.`),
  );
  if (hearing) {
    sections.file.push(
      item("source", `الجلسة المعنية: ${hearing.type} بتاريخ ${formatArabicDate(hearing.date)} على الساعة ${hearing.time} — ${hearing.court}، ${hearing.room}.`),
    );
  } else {
    sections.file.push(item("missing", "لا توجد جلسة قادمة مبرمجة لهذه القضية في المفكرة."));
  }

  // 2. Facts: case description + first statements of each document (verbatim, cited).
  sections.facts.push(item("source", `ملخص الملف المسجّل: ${legalCase.description}`));
  for (const doc of docs) {
    const first = all.filter((s) => s.doc.id === doc.id).slice(0, doc.externalOrigin ? 1 : 2);
    for (const s of first) {
      sections.facts.push(
        item("source", doc.externalOrigin ? `(وثيقة واردة من خارج المكتب — غير موثوقة) ${s.text}` : s.text, [cite(s)]),
      );
    }
  }
  if (docs.length === 0) sections.facts.push(item("missing", "لا توجد وثائق مرفقة بالملف يمكن استخراج الوقائع منها."));

  // 3. Timeline (records).
  const events = [
    ...db.timeline.filter((t) => t.caseId === caseId).map((t) => ({ date: t.date.slice(0, 10), text: `${t.title}: ${t.description}` })),
    ...hearingsForCase(caseId, db, user).map((h) => ({ date: h.date, text: `${h.type} — ${h.court}، ${h.room} (${h.time})` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of events.slice(-10)) sections.timeline.push(item("source", `${formatArabicDate(e.date)} — ${e.text}`));

  // 4. Legal points (generated, framed as questions to verify; triggered by retrieved content).
  const improvements = has(all, /(طابق|بناء|تحسين)/);
  const copies = has(all, /(نسخ|اصول)/);
  const reasoning = has(all, /(تعليل|لم تناقش|عدم الرد)/);
  if (legalCase.type === "نزاع ميراث") {
    sections.legal.push(
      item("generated", "القواعد المنظِّمة لقسمة التركة وضبط المنابات الشرعية وانطباقها على العقار موضوع النزاع — يجب الرجوع إلى النصوص الرسمية والتحقق منها؛ لم يُسترجع نصّها من مصدر موثّق."),
    );
  }
  if (improvements.length) {
    sections.legal.push(
      item("generated", "مدى احتساب التحسينات المنجزة من أحد الورثة عند القسمة، وعلى من يقع عبء إثبات تاريخ إنجازها ومصدر تمويلها.", improvements.slice(0, 2).map(cite)),
    );
  }
  if (copies.length) {
    sections.legal.push(item("generated", "القيمة الإثباتية لنسخ الوثائق عند عدم الإدلاء بأصولها.", copies.slice(0, 2).map(cite)));
  }
  if (reasoning.length || legalCase.court.includes("التعقيب")) {
    sections.legal.push(
      item("generated", "حدود رقابة محكمة التعقيب على كفاية التعليل والرد على الدفوع الجوهرية.", reasoning.slice(0, 2).map(cite)),
    );
  }
  if (sections.legal.length === 0) {
    sections.legal.push(item("generated", "لم تُرصد في الوثائق المتاحة مسائل قانونية محددة؛ يُقترح تحديد الإشكاليات يدوياً بعد مراجعة الملف."));
  }

  // 5. Possible arguments: numbered grounds from our own filings (verbatim) + prior archive judgments.
  const grounds = ownSentences.filter((s) => /^(اولا|ثانيا|ثالثا|رابعا|خامسا)/.test(normalizeText(s.text)));
  for (const g of grounds) sections.arguments.push(item("source", g.text, [cite(g)]));
  const prior = searchDocuments(`${legalCase.type} ${legalCase.client}`, { scope: "archive", client: legalCase.client }, db, user).hits.filter(
    (h) => h.document.caseRef !== legalCase.ref,
  );
  for (const hit of prior.slice(0, 2)) {
    const decision = hit.document.pages.flatMap((p) => sentencesOf({ ...hit.document, pages: [p] }).kept).find((s) =>
      /(لهذه الاسباب|حكمت|قضت)/.test(normalizeText(s.text)),
    );
    sections.arguments.push(
      item(
        "generated",
        `الاستئناس بالملف السابق ${hit.document.caseRef} (${hit.document.docType}، ${hit.document.date.slice(0, 4)}) لنفس الحريف، مع التحقق من مدى تشابه الوقائع ونهائية الحكم قبل الاحتجاج به.`,
        decision ? [cite(decision)] : [],
      ),
    );
  }
  if (sections.arguments.length === 0) {
    sections.arguments.push(item("generated", "لا توجد مذكرات أو عرائض من إعداد المكتب في الملف لاستخراج الحجج منها؛ يُقترح صياغة الحجج بعد مراجعة الوثائق."));
  }

  // 6. Expected counter-arguments: what the court record says the other side argued.
  const counter = otherSentences.filter((s) => /(تمسك|يتمسك|طلب|يقترح)/.test(normalizeText(s.text)) && !/الطاعن|المدعون|نائب الطاعنين/.test(normalizeText(s.text)));
  for (const s of counter.slice(0, 4)) {
    sections.counter.push(
      item("source", s.doc.externalOrigin ? `(ادعاء الطرف المقابل — وثيقة غير موثوقة) ${s.text}` : s.text, [cite(s)]),
    );
  }
  if (sections.counter.length === 0) sections.counter.push(item("generated", "لم تُسترجع مواقف موثّقة للطرف المقابل من الوثائق المتاحة."));

  // 7. Weaknesses (generated from signals, cited where possible).
  const witnesses = has(ownSentences, /الشهود/);
  if (witnesses.length && !docs.some((d) => /شهاد(ه|ة) (الشهود|شهود)|محضر سماع/.test(d.title))) {
    sections.weaknesses.push(
      item("generated", "يعتمد أحد المطاعن على شهادة الشهود دون وجود محضر سماع أو شهادة مكتوبة في الملف — دليل غير معزّز.", witnesses.slice(0, 1).map(cite)),
    );
  }
  for (const s of has(otherSentences, /(دون ان|لم يقع|لم يتم|لم تقدم)/).slice(0, 2)) {
    sections.weaknesses.push(item("generated", "نقطة غير محسومة في الملف قد تُستغل من أي من الطرفين وتتطلب تقييماً:", [cite(s)]));
  }

  // 8. Missing documents: indicative checklist + what the court explicitly requested.
  const present = docs.map((d) => normalizeText(`${d.title} ${d.docType}`));
  for (const expected of EXPECTED_DOCUMENTS[legalCase.type] ?? []) {
    const key = normalizeText(expected).split(" ").slice(0, 2).join(" ");
    if (!present.some((p) => p.includes(key))) {
      sections.missing.push(item("missing", `${expected} — غير موجودة في الملف (قائمة مرجعية تقديرية).`));
    }
  }
  for (const s of has(otherSentences, /(اجلا للادلاء|للادلاء ب|الادلاء باصول)/)) {
    sections.missing.push(item("missing", "طلبت المحكمة وثائق يجب التثبت من الإدلاء بها:", [cite(s)]));
  }

  // 9. Questions for the hearing (generated).
  if (improvements.length) sections.questions.push(item("generated", "ما الدليل المكتوب على تاريخ إنجاز الأشغال الإضافية ومن موّلها؟", improvements.slice(0, 1).map(cite)));
  if (copies.length) sections.questions.push(item("generated", "هل أدلى الطرف المقابل بأصول الفواتير أم بنسخ فقط؟", copies.slice(0, 1).map(cite)));
  sections.questions.push(item("generated", "هل تم تبليغ جميع الأطراف بالإجراءات في الآجال، وهل توجد إخلالات شكلية يجب إثارتها؟"));

  // 10. References to verify — never invent article numbers.
  for (const code of KNOWN_CODES) {
    const where = all.find((s) => normalizeText(s.text).includes(normalizeText(code)));
    if (where) {
      sections.verify.push(
        item("verify", `ورد ذكر «${code}» في الوثائق دون تحديد فصول: يجب الرجوع إلى النص الرسمي المحيّن قبل الاستشهاد بأي فصل.`, [cite(where)]),
      );
    }
  }
  for (const hit of prior.slice(0, 2)) {
    sections.verify.push(item("verify", `التحقق من نهائية ونص الحكم السابق ${hit.document.caseRef} من النسخة الرسمية قبل الاحتجاج به.`));
  }
  sections.verify.push(
    item("verify", "لم تُسترجع أي نصوص تشريعية أو قرارات فقه قضاء من قاعدة مرجعية موثّقة؛ لا تتضمن هذه المسودة أرقام فصول أو أحكاماً غير موجودة في الأرشيف."),
  );

  const builtSections: BriefSection[] = BRIEF_SECTIONS.map((s) => ({ key: s.key, title: s.title, items: sections[s.key] }));
  const citations = dedupeCitations(builtSections.flatMap((s) => s.items.flatMap((i) => i.citations)));
  const stamp = new Date().toISOString();

  return {
    brief: {
      id: newId("brief"),
      caseId,
      hearingId: hearing?.id,
      title: `مذكرة تحضيرية — ${legalCase.client}${hearing ? ` — جلسة ${formatArabicDate(hearing.date)}` : ""}`,
      createdAt: stamp,
      updatedAt: stamp,
      createdBy: user.id,
      reviewed: false,
      sections: builtSections,
    },
    citations,
    droppedInstructions: dropped,
    missingCount: sections.missing.length,
    hearing,
  };
}

export function dedupeCitations(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.documentId}#${c.page ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function caseLabel(c: LegalCase): string {
  return `${c.client} — ${c.ref}`;
}
