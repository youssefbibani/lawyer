/**
 * Demo assistant engine: interprets a message, retrieves authorised data and either
 * answers (read-only intents) or prepares a PendingAction preview (write intents).
 *
 * Pipeline for writes: interpret intent → validate entities → check authorization →
 * resolve case/hearing references → compute missing fields & inferences → preview.
 * Conflict checks run live in the preview; execution happens only after explicit
 * confirmation via `executeAction` (see actions.ts).
 */
import type { Hearing, LegalCase, TeamMember } from "@/types";
import { normalizeText } from "@/lib/arabic";
import { addDays, parseISODate, startOfDay, toISODate, urgencyOf } from "@/lib/dates";
import { formatArabicDate, formatCurrency } from "@/lib/formatters";
import { urgencyLabelOf, urgencyToneOf } from "@/lib/status";
import { getDB, newId, type DemoDatabase } from "@/services/db";
import {
  accessibleCases,
  accessibleHearings,
  accessiblePayments,
  accessibleTasks,
  currentUser,
  documentsForCase,
  getTeam,
  hearingConflictGroups,
  nextHearingForCase,
  nextReceiptNumber,
  sortHearings,
  upcomingHearings,
} from "@/services/api";
import { can, PERMISSION_DENIED_MESSAGES, type Permission } from "@/services/permissions";
import { citationFor, searchDocuments } from "@/services/retrieval";
import { fold, parseMessage, type ParsedMessage } from "@/services/assistant/intent";
import { dedupeCitations, generateBrief } from "@/services/assistant/brief";
import {
  isWriteIntent,
  type ActionFields,
  type AssistantBlock,
  type AssistantListItem,
  type ConversationMemory,
  type Intent,
  type PendingAction,
  type WriteIntent,
} from "@/services/assistant/types";
import { EXPECTED_DOCUMENTS } from "@/data/mock";

export interface EngineContext {
  caseId?: string;
  memory: ConversationMemory;
  pendingAction?: PendingAction;
  now?: Date;
}

export interface EngineResponse {
  intent: Intent;
  text: string;
  blocks: AssistantBlock[];
  action?: PendingAction;
  memory: ConversationMemory;
  /** Id of a pending action superseded by this response (merged follow-up). */
  supersedes?: string;
}

// ——— Case & hearing resolution ———

type CaseResolution =
  | { status: "resolved"; legalCase: LegalCase; note?: string }
  | { status: "ambiguous"; candidates: LegalCase[] }
  | { status: "not_found"; mention: string }
  | { status: "none" };

/** Generic words that must never count as a client-name match ("family", "company", "heirs"…). */
const NAME_STOPWORDS = new Set(["عائلة", "عايلة", "شركة", "ورثة", "للتجارة", "مؤسسة", "السيد", "السيدة"].map(fold));

function clientTokens(client: string): string[] {
  return fold(client)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t))
    .map((t) => (t.startsWith("ال") && t.length > 4 ? t.slice(2) : t));
}

function matchClients(n: string, list: LegalCase[]): LegalCase[] {
  return list.filter((c) => {
    const full = fold(c.client);
    if (n.includes(full)) return true;
    return clientTokens(c.client).some((t) => new RegExp(`(^|\\s|ل|ب|و)(ال)?${t}(\\s|$)`).test(n));
  });
}

export function resolveCase(parsed: ParsedMessage, ctx: EngineContext, db: DemoDatabase, user: TeamMember): CaseResolution {
  const accessible = accessibleCases(db, user);
  if (parsed.caseRef) {
    const found = accessible.find((c) => c.ref === parsed.caseRef);
    return found ? { status: "resolved", legalCase: found } : { status: "not_found", mention: parsed.caseRef };
  }
  const byClient = matchClients(parsed.folded, accessible);
  if (byClient.length === 1) return { status: "resolved", legalCase: byClient[0] };
  if (byClient.length > 1) return { status: "ambiguous", candidates: byClient };
  // A name that matches only restricted files is reported as "not found" (no existence leak).
  if (matchClients(parsed.folded, db.cases).length > 0) {
    return { status: "not_found", mention: parsed.mentionText ?? "القضية المذكورة" };
  }
  const contextCase = accessible.find((c) => c.id === ctx.caseId);
  if (parsed.deicticCase) {
    return contextCase ? { status: "resolved", legalCase: contextCase, note: "القضية المحددة حالياً في المحادثة" } : { status: "none" };
  }
  if (parsed.caseType && !contextCase) {
    const ofType = accessible.filter((c) => c.type === parsed.caseType && c.status !== "منتهية");
    if (ofType.length === 1) return { status: "resolved", legalCase: ofType[0], note: `استُنتجت القضية من نوع النزاع (${parsed.caseType})` };
    if (ofType.length > 1) return { status: "ambiguous", candidates: ofType };
  }
  if (contextCase) return { status: "resolved", legalCase: contextCase, note: "القضية المحددة حالياً في المحادثة" };
  const remembered = accessible.find((c) => c.id === ctx.memory.lastCaseId);
  if (remembered) return { status: "resolved", legalCase: remembered, note: "القضية المذكورة سابقاً في المحادثة" };
  if (parsed.mentionText && /(ملف|قضيه|عائله|حريف)/.test(parsed.folded)) {
    return { status: "not_found", mention: parsed.mentionText };
  }
  return { status: "none" };
}

function resolveHearing(
  parsed: ParsedMessage,
  resolution: CaseResolution,
  ctx: EngineContext,
  db: DemoDatabase,
  user: TeamMember,
  now: Date,
): { hearing?: Hearing; note?: string } {
  const hearings = accessibleHearings(db, user);
  if (parsed.refersToHearing === "previous" && ctx.memory.lastHearingId) {
    const h = hearings.find((x) => x.id === ctx.memory.lastHearingId);
    if (h) return { hearing: h, note: "الجلسة المذكورة سابقاً في المحادثة" };
  }
  if (resolution.status === "resolved") {
    const h = nextHearingForCase(resolution.legalCase.id, now, db, user);
    return h ? { hearing: h, note: `أقرب جلسة قادمة في ملف ${resolution.legalCase.client}` } : {};
  }
  if (parsed.refersToHearing) {
    const today = toISODate(now);
    const h = sortHearings(hearings.filter((x) => x.date >= today))[0];
    if (h) return { hearing: h, note: "أقرب جلسة قادمة في المفكرة (لم تُحدَّد قضية)" };
  }
  return {};
}

// ——— Shared helpers ———

function hearingItem(h: Hearing, db: DemoDatabase, now: Date): AssistantListItem {
  const c = db.cases.find((x) => x.ref === h.caseRef);
  const urgency = urgencyOf(h.date, now);
  return {
    id: h.id,
    title: `${h.client} — ${h.type}`,
    subtitle: `${h.court}، ${h.room}`,
    meta: `${formatArabicDate(h.date)} — ${h.time}`,
    href: c ? `/app/cases/${c.id}` : "/app/agenda",
    badge: { label: urgencyLabelOf(urgency), tone: urgencyToneOf(urgency) },
  };
}

function denied(permission: Permission): EngineResponse["blocks"] {
  return [{ type: "notice", tone: "danger", text: PERMISSION_DENIED_MESSAGES[permission] }];
}

function caseChoiceText(candidates: LegalCase[]): string {
  return `وجدت أكثر من قضية مطابقة: ${candidates.map((c) => `«${c.client}» (${c.ref})`).join("، ")}. حدّد القضية المقصودة من القائمة أو اذكر المرجع.`;
}

function notFoundText(mention: string): string {
  return `لم أجد قضية مطابقة لـ«${mention}» ضمن الملفات المصرّح لك بها. تثبّت من الاسم أو المرجع، أو اختر القضية من محدد القضايا.`;
}

const REVIEW_NOTICE: AssistantBlock = {
  type: "notice",
  tone: "warning",
  text: "مسودة آلية للمساعدة فقط — ليست رأياً قانونياً معتمداً. المراجعة من طرف المحامي إلزامية قبل أي استعمال.",
};

// ——— Read handlers ———

function listHearings(parsed: ParsedMessage, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  const today = startOfDay(now);
  const range = parsed.range ?? (parsed.date ? { from: parsed.date.iso, to: parsed.date.iso, label: formatArabicDate(parsed.date.iso) } : undefined);
  const from = range ? parseISODate(range.from) : today;
  const to = range ? parseISODate(range.to) : addDays(today, 14);
  const label = range?.label ?? "خلال الأسبوعين القادمين";
  const list = upcomingHearings(from, to, db, user);
  const blocks: AssistantBlock[] = [];
  const text = list.length
    ? `لديك ${list.length} ${list.length === 1 ? "جلسة" : "جلسات"} ${label} (من ${formatArabicDate(from)} إلى ${formatArabicDate(to)}):`
    : `لا توجد جلسات مسجّلة في مفكرتك ${label} (من ${formatArabicDate(from)} إلى ${formatArabicDate(to)}).`;
  if (list.length) blocks.push({ type: "list", items: list.map((h) => hearingItem(h, db, now)) });

  const conflicts = hearingConflictGroups(db, user).filter((g) => g.some((h) => list.includes(h)));
  for (const g of conflicts) {
    blocks.push({
      type: "notice",
      tone: "danger",
      text: `تعارض: ${g.map((h) => `${h.client} (${h.caseRef})`).join(" و")} في نفس التوقيت ${formatArabicDate(g[0].date)} على الساعة ${g[0].time}.`,
    });
  }

  if (parsed.withSummary && list.length) {
    const items: AssistantListItem[] = [];
    for (const h of list) {
      const c = accessibleCases(db, user).find((x) => x.ref === h.caseRef);
      if (!c) continue;
      const openTasks = accessibleTasks(db, user).filter((t) => t.caseId === c.id && !t.completed).length;
      const docs = documentsForCase(c.id, db, user);
      const missing = (EXPECTED_DOCUMENTS[c.type] ?? []).filter((e) => !docs.some((d) => normalizeText(d.title).includes(normalizeText(e).split(" ")[0]))).length;
      items.push({
        id: `sum-${h.id}`,
        title: `${c.client} — ${c.type}`,
        subtitle: c.description,
        meta: `${docs.length} وثائق • ${openTasks} مهام مفتوحة${missing ? ` • ${missing} وثائق قد تكون ناقصة` : ""}`,
        href: `/app/cases/${c.id}`,
      });
    }
    blocks.push({ type: "list", title: "ملخص الملفات المعنية (من بطاقات القضايا)", items });
  }
  return { intent: "list_upcoming_hearings", text, blocks, memory: { lastHearingId: list[0]?.id } };
}

function checkConflicts(db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  const today = toISODate(now);
  const groups = hearingConflictGroups(db, user).filter((g) => g[0].date >= today);
  if (!groups.length) {
    return { intent: "check_hearing_conflicts", text: "لا يوجد أي تعارض بين الجلسات القادمة المسجّلة في مفكرتك.", blocks: [], memory: {} };
  }
  return {
    intent: "check_hearing_conflicts",
    text: `رصدت ${groups.length} ${groups.length === 1 ? "حالة تعارض" : "حالات تعارض"} في الجلسات القادمة:`,
    blocks: groups.flatMap<AssistantBlock>((g) => [
      { type: "notice", tone: "danger", text: `${formatArabicDate(g[0].date)} على الساعة ${g[0].time}: ${g.length} جلسات في نفس التوقيت.` },
      { type: "list", items: g.map((h) => hearingItem(h, db, now)) },
    ]),
    memory: { lastHearingId: groups[0][0].id },
  };
}

function unpaidFees(resolution: CaseResolution, db: DemoDatabase, user: TeamMember): EngineResponse {
  if (!can(user, "finance:read")) return { intent: "query_unpaid_fees", text: "لا يمكنني عرض البيانات المالية.", blocks: denied("finance:read"), memory: {} };
  let list = accessiblePayments(db, user).filter((p) => p.remaining > 0);
  if (resolution.status === "resolved") list = list.filter((p) => p.caseRef === resolution.legalCase.ref);
  const total = list.reduce((s, p) => s + p.remaining, 0);
  const text = list.length
    ? `الأتعاب غير المستخلصة: ${list.length} ${list.length === 1 ? "ملف" : "ملفات"} بمجموع ${formatCurrency(total)}.`
    : "لا توجد أتعاب غير مستخلصة في الملفات المصرّح لك بها.";
  const items: AssistantListItem[] = list.map((p) => {
    const c = db.cases.find((x) => x.ref === p.caseRef);
    return {
      id: p.id,
      title: p.client,
      subtitle: `المتفق عليه ${formatCurrency(p.agreed)} — المدفوع ${formatCurrency(p.paid)}`,
      meta: `المتبقي ${formatCurrency(p.remaining)}${p.lastPaymentDate ? ` • آخر دفعة ${formatArabicDate(p.lastPaymentDate)}` : " • لا توجد أي دفعة"}`,
      href: c ? `/app/cases/${c.id}` : "/app/payments",
      badge: { label: p.status, tone: p.status === "غير مدفوع" ? "alert" : "gold" },
    };
  });
  return {
    intent: "query_unpaid_fees",
    text,
    blocks: list.length
      ? [
          { type: "list", items },
          { type: "notice", tone: "info", text: "يمكنك أن تطلب مثلاً: «حضّرلي تذكير بالخلاص لسامي مراد» لإعداد مسودة رسالة (لا يتم الإرسال آلياً)." },
        ]
      : [],
    memory: {},
  };
}

function searchCase(resolution: CaseResolution, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  if (resolution.status === "ambiguous") return { intent: "search_case", text: caseChoiceText(resolution.candidates), blocks: [caseList(resolution.candidates, db, user, now)], memory: {} };
  if (resolution.status === "not_found") return { intent: "search_case", text: notFoundText(resolution.mention), blocks: [], memory: {} };
  if (resolution.status === "none") return { intent: "search_case", text: "حدّد اسم الحريف أو مرجع القضية التي تبحث عنها.", blocks: [], memory: {} };
  const c = resolution.legalCase;
  return { intent: "search_case", text: `هذا ملف ${c.client}:`, blocks: [caseList([c], db, user, now)], memory: { lastCaseId: c.id } };
}

function caseList(list: LegalCase[], db: DemoDatabase, user: TeamMember, now: Date): AssistantBlock {
  return {
    type: "list",
    items: list.map((c) => {
      const next = nextHearingForCase(c.id, now, db, user);
      return {
        id: c.id,
        title: `${c.client} — ${c.type}`,
        subtitle: c.court,
        meta: `${c.ref}${next ? ` • الجلسة القادمة ${formatArabicDate(next.date)}` : ""}`,
        href: `/app/cases/${c.id}`,
        badge: { label: c.status, tone: c.status === "نشطة" ? "success" : c.status === "مؤجلة" ? "gold" : "neutral" },
      };
    }),
  };
}

function summarizeCase(resolution: CaseResolution, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  if (resolution.status !== "resolved") return needCase("summarize_case", resolution, db, user, now);
  const c = resolution.legalCase;
  const gen = generateBrief(c.id, { now }, db, user);
  if (!gen) return needCase("summarize_case", { status: "none" }, db, user, now);
  const pick = (key: string) => gen.brief.sections.find((s) => s.key === key)?.items ?? [];
  const next = nextHearingForCase(c.id, now, db, user);
  const openTasks = accessibleTasks(db, user).filter((t) => t.caseId === c.id && !t.completed);
  const blocks: AssistantBlock[] = [];
  if (resolution.note) blocks.push({ type: "notice", tone: "info", text: `تم اعتماد: ${resolution.note}.` });
  blocks.push({
    type: "list",
    title: "الوقائع المسترجعة من الملف",
    items: pick("facts").map((i) => ({ id: i.id, title: i.text, meta: i.citations[0] ? `${i.citations[0].title} — ص ${i.citations[0].page}` : "بطاقة القضية" })),
  });
  blocks.push({
    type: "list",
    title: "التسلسل الزمني",
    items: pick("timeline").map((i) => ({ id: i.id, title: i.text })),
  });
  if (openTasks.length) {
    blocks.push({
      type: "list",
      title: "مهام مفتوحة",
      items: openTasks.map((t) => ({ id: t.id, title: t.title, meta: formatArabicDate(t.dueDate), href: "/app/tasks" })),
    });
  }
  const missing = pick("missing");
  if (missing.length) blocks.push({ type: "notice", tone: "warning", text: `وثائق قد تكون ناقصة: ${missing.map((m) => m.text.split(" — ")[0].replace(/:$/, "")).join("، ")}.` });
  if (gen.droppedInstructions) blocks.push(injectionNotice(gen.droppedInstructions));
  if (gen.citations.length) blocks.push({ type: "sources", title: "المصادر المسترجعة", citations: gen.citations });
  blocks.push({ type: "notice", tone: "info", text: "هذا الملخص مبني حصرياً على بيانات الملف ووثائقه المتاحة لك؛ لا يتضمن أي استنتاج قانوني." });
  return {
    intent: "summarize_case",
    text: `ملخص ملف ${c.client} (${c.ref}) — ${c.type} أمام ${c.court}. الحالة: ${c.status}.${next ? ` الجلسة القادمة: ${next.type} يوم ${formatArabicDate(next.date)} على الساعة ${next.time}.` : " لا توجد جلسة قادمة مبرمجة."}`,
    blocks,
    memory: { lastCaseId: c.id, lastHearingId: next?.id },
  };
}

function injectionNotice(count: number): AssistantBlock {
  return {
    type: "notice",
    tone: "danger",
    text: `رُصدت ${count === 1 ? "جملة" : `${count} جمل`} داخل وثيقة واردة تشبه تعليمات موجّهة لنظام آلي. تم تجاهلها ومعاملتها كنص غير موثوق، ولم يُنفَّذ أي إجراء بناءً عليها.`,
  };
}

function prepareHearing(resolution: CaseResolution, parsed: ParsedMessage, ctx: EngineContext, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  let res = resolution;
  if (res.status === "none" && parsed.refersToHearing) {
    const { hearing } = resolveHearing(parsed, res, ctx, db, user, now);
    const c = hearing && accessibleCases(db, user).find((x) => x.ref === hearing.caseRef);
    if (c) res = { status: "resolved", legalCase: c, note: "ملف أقرب جلسة قادمة في المفكرة" };
  }
  if (res.status !== "resolved") return needCase("prepare_hearing", res, db, user, now);
  const gen = generateBrief(res.legalCase.id, { now }, db, user);
  if (!gen) return needCase("prepare_hearing", { status: "none" }, db, user, now);
  const blocks: AssistantBlock[] = [];
  if (res.note) blocks.push({ type: "notice", tone: "info", text: `تم اعتماد: ${res.note}.` });
  blocks.push({ type: "brief", brief: gen.brief });
  if (gen.droppedInstructions) blocks.push(injectionNotice(gen.droppedInstructions));
  if (gen.missingCount) blocks.push({ type: "notice", tone: "warning", text: `${gen.missingCount} عناصر مدرجة كوثائق ناقصة أو مطلوبة — راجع قسم «الوثائق الناقصة».` });
  blocks.push({ type: "sources", title: "المصادر المسترجعة المعتمدة في المسودة", citations: gen.citations });
  blocks.push(REVIEW_NOTICE);
  return {
    intent: "prepare_hearing",
    text: `أعددت مسودة مذكرة تحضيرية لملف ${res.legalCase.client}${gen.hearing ? ` استعداداً لـ${gen.hearing.type} يوم ${formatArabicDate(gen.hearing.date)}` : ""}. العناصر المقتبسة من الوثائق موسومة بمصدرها، والعناصر المقترحة موسومة كاقتراح يتطلب المراجعة.`,
    blocks,
    memory: { lastCaseId: res.legalCase.id, lastHearingId: gen.hearing?.id },
  };
}

function searchArchive(parsed: ParsedMessage, db: DemoDatabase, user: TeamMember): EngineResponse {
  if (!can(user, "document:read")) return { intent: "search_archive", text: "لا يمكنني البحث في الأرشيف.", blocks: denied("document:read"), memory: {} };
  const query = [parsed.searchQuery, parsed.year].filter(Boolean).join(" ").trim();
  if (!query) {
    return { intent: "search_archive", text: "ما الذي تبحث عنه في الأرشيف؟ اذكر موضوع النزاع أو اسم الحريف أو السنة.", blocks: [], memory: {} };
  }
  let response = searchDocuments(query, { scope: "archive", docType: parsed.docType, year: parsed.year }, db, user);
  const blocks: AssistantBlock[] = [];
  if (!response.hits.length && (parsed.docType || parsed.year)) {
    response = searchDocuments(query, { scope: "archive" }, db, user);
    if (response.hits.length) {
      blocks.push({ type: "notice", tone: "info", text: "لم أجد نتائج بنوع الوثيقة أو السنة المطلوبة تحديداً؛ هذه أقرب النتائج بدون هذا القيد." });
    }
  }
  if (!response.hits.length) {
    return {
      intent: "search_archive",
      text: `لم أجد أي وثيقة مطابقة لـ«${query}» في الأرشيف المصرّح لك به. لن أقترح أحكاماً أو مراجع غير موجودة في الأرشيف.`,
      blocks: [{ type: "notice", tone: "info", text: "جرّب كلمات أخرى (مثلاً: تركة، قسمة، عقار) أو استعمل صفحة البحث في الأرشيف مع المرشحات." }],
      memory: {},
    };
  }
  const hits = response.hits.slice(0, 5);
  if (hits.some((h) => h.injectionSuspected)) blocks.push(injectionNotice(1));
  blocks.push({ type: "sources", title: "وثائق مسترجعة من الأرشيف (مرتبة حسب الصلة)", citations: hits.map((h) => citationFor(h)) });
  blocks.push({
    type: "list",
    title: "درجة الصلة",
    items: hits.map((h) => ({
      id: h.document.id,
      title: `${h.document.title} — ${h.document.client}`,
      meta: `${h.document.caseRef} • ${h.document.date.slice(0, 4)} • الصفحة ${h.bestPage.page}${h.document.verified ? " • موثّقة بعد مراجعة بشرية" : ""}${h.expansionOnly ? " • تطابق مفهومي فقط" : ""}`,
      href: `/app/document/${h.document.id}?page=${h.bestPage.page}`,
      badge: { label: h.relevance, tone: h.relevance === "قوي" ? "success" : h.relevance === "متوسط" ? "gold" : "neutral" },
    })),
  });
  if (response.expandedTerms.length) {
    blocks.push({ type: "notice", tone: "info", text: `شمل البحث مرادفات عربية وفرنسية: ${response.expandedTerms.slice(0, 6).join("، ")}.` });
  }
  return {
    intent: "search_archive",
    text: `وجدت ${response.hits.length} ${response.hits.length === 1 ? "وثيقة" : "وثائق"} في الأرشيف${parsed.year ? ` لسنة ${parsed.year}` : ""}. النتائج مقتصرة على الملفات المصرّح لك بها.`,
    blocks,
    memory: {},
  };
}

function compareCases(resolution: CaseResolution, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  if (resolution.status !== "resolved") return needCase("compare_cases", resolution, db, user, now);
  const c = resolution.legalCase;
  const hits = searchDocuments(`${c.type} ${c.client}`, { scope: "archive" }, db, user).hits.filter((h) => h.document.caseRef !== c.ref).slice(0, 2);
  if (!hits.length) {
    return { intent: "compare_cases", text: `لم أجد في الأرشيف المتاح قضايا سابقة يمكن مقارنتها بملف ${c.client}.`, blocks: [], memory: { lastCaseId: c.id } };
  }
  const blocks: AssistantBlock[] = [];
  for (const hit of hits) {
    const decisionPage = hit.document.pages.find((p) => /(لهذه الاسباب|حكمت|قضت|confirme)/.test(normalizeText(p.text)));
    const decision = decisionPage?.text.split(/\n+/).find((s) => /(لهذه الاسباب|حكمت|قضت|confirme)/.test(normalizeText(s)));
    blocks.push({
      type: "comparison",
      title: `مقارنة مع ${hit.document.caseRef} (${hit.document.date.slice(0, 4)})`,
      currentLabel: `الملف الحالي ${c.ref}`,
      previousLabel: `${hit.document.title}`,
      rows: [
        { aspect: "الأطراف", current: c.client, previous: hit.document.client },
        { aspect: "موضوع النزاع", current: c.description, previous: hit.bestPage.snippet, citation: citationFor(hit) },
        { aspect: "الجهة القضائية", current: c.court, previous: hit.document.pages[0]?.text.split(/\n/)[0] ?? "—" },
        {
          aspect: "ما انتهى إليه الملف السابق",
          current: "قيد النظر",
          previous: decision ?? "لم يُسترجع منطوق صريح من الوثيقة",
          citation: decision && decisionPage ? { ...citationFor(hit), page: decisionPage.number, excerpt: decision } : undefined,
        },
      ],
    });
  }
  blocks.push({
    type: "suggestions",
    title: "نقاط مقترحة للتحقق (اقتراح آلي)",
    items: [
      "التحقق من تطابق الوقائع الجوهرية فعلاً قبل الاستئناس بالملف السابق، لا مجرد تشابه نوع النزاع.",
      "التثبت من نهائية الحكم السابق ومن النسخة الرسمية قبل الاحتجاج به.",
      "تحديد أوجه الاختلاف (الأطراف، العقار، تاريخ الوقائع) التي قد يستند إليها الطرف المقابل لاستبعاد المقارنة.",
    ],
  });
  blocks.push({ type: "sources", title: "المصادر", citations: dedupeCitations(hits.map((h) => citationFor(h))) });
  blocks.push(REVIEW_NOTICE);
  return { intent: "compare_cases", text: `قارنت ملف ${c.client} بـ${hits.length} ${hits.length === 1 ? "ملف سابق" : "ملفات سابقة"} من الأرشيف. الخانات المقتبسة موسومة بمصدرها.`, blocks, memory: { lastCaseId: c.id } };
}

function archiveStatus(db: DemoDatabase, user: TeamMember): EngineResponse {
  if (!can(user, "archive:process")) return { intent: "archive_status", text: "لا يمكنني عرض حالة الأرشفة.", blocks: denied("archive:process"), memory: {} };
  const batches = db.batches.filter((b) => b.tenantId === db.tenantId);
  const items = db.archiveItems.filter((i) => i.tenantId === db.tenantId);
  const n = (b: string, states: string[]) => items.filter((i) => i.batchId === b && states.includes(i.state)).length;
  return {
    intent: "archive_status",
    text: batches.length ? `حالة دفعات الأرشفة (${batches.length}):` : "لا توجد دفعات أرشفة بعد.",
    blocks: batches.length
      ? [
          {
            type: "list",
            items: batches.map((b) => ({
              id: b.id,
              title: `${b.name}`,
              subtitle: `${b.reference} — ${b.location}`,
              meta: `${items.filter((i) => i.batchId === b.id).length} وثائق • مراجعة ${n(b.id, ["review", "needs_correction"])} • موافقة ${n(b.id, ["pending_approval"])} • جاهزة ${n(b.id, ["ready"])} • مؤرشفة ${n(b.id, ["archived"])}`,
              href: `/app/archive/batches/${b.id}`,
            })),
          },
          { type: "notice", tone: "info", text: "أستطيع التلخيص واقتراح التصحيحات والقضايا داخل شاشة المراجعة، لكن الاعتماد والربط والحفظ قرارات بشرية فقط." },
        ]
      : [],
    memory: {},
  };
}

function needCase(intent: Intent, resolution: CaseResolution, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  if (resolution.status === "ambiguous") return { intent, text: caseChoiceText(resolution.candidates), blocks: [caseList(resolution.candidates, db, user, now)], memory: {} };
  if (resolution.status === "not_found") return { intent, text: notFoundText(resolution.mention), blocks: [], memory: {} };
  return { intent, text: "على أي قضية؟ اختر القضية من محدد القضايا أعلى المحادثة أو اذكر اسم الحريف أو المرجع.", blocks: [], memory: {} };
}

const HELP_ITEMS = [
  "ملخص قضية: «حضّرلي ملخص للقضية متاع عائلة بن صالح»",
  "الجلسات: «شنوة الجلسات اللي عندي الأسبوع الجاي؟»",
  "تحضير الجلسة: «اقترح حجج قانونية للملف هذا»",
  "الأرشيف: «فتّشلي على حكم قديم في نزاع ميراث»",
  "برمجة جلسة: «سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10»",
  "تذكير: «ذكّرني قبل الجلسة بيومين»",
  "الأتعاب: «ورّيني الأتعاب اللي مازالت ما تخلّصتش»",
];

// ——— Write planning ———

const WRITE_PERMISSIONS: Record<WriteIntent, Permission> = {
  create_hearing: "hearing:write",
  update_hearing: "hearing:write",
  create_reminder: "task:write",
  create_task: "task:write",
  draft_payment_reminder: "finance:read",
  draft_receipt: "finance:write",
};

export const ACTION_TITLES: Record<WriteIntent, string> = {
  create_hearing: "برمجة جلسة جديدة",
  update_hearing: "تعديل موعد جلسة",
  create_reminder: "إنشاء تذكير",
  create_task: "إنشاء مهمة",
  draft_payment_reminder: "مسودة تذكير بالدفع",
  draft_receipt: "إصدار وصل أتعاب",
};

export const FIELD_LABELS: Partial<Record<keyof ActionFields, string>> = {
  caseId: "القضية",
  hearingId: "الجلسة",
  date: "التاريخ",
  time: "الساعة",
  title: "العنوان",
  paymentId: "سجل الأتعاب",
  amount: "المبلغ",
  text: "نص الرسالة",
};

/** Required fields still empty — confirmation stays disabled until this is empty. */
export function missingFields(action: PendingAction): (keyof ActionFields)[] {
  const f = action.fields;
  const required: Record<WriteIntent, (keyof ActionFields)[]> = {
    create_hearing: ["caseId", "date", "time"],
    update_hearing: ["hearingId", "date", "time"],
    create_reminder: ["title", "date"],
    create_task: ["title", "date"],
    draft_payment_reminder: ["paymentId", "text"],
    draft_receipt: ["paymentId", "amount"],
  };
  return required[action.intent].filter((k) => f[k] === undefined || f[k] === "" || (k === "amount" && !(Number(f.amount) > 0)));
}

function paymentReminderText(client: string, ref: string, remaining: number, user: TeamMember): string {
  return `السيد(ة) ${client} المحترم(ة)،\n\nتحية طيبة، وبعد،\n\nنحيطكم علماً بأن مبلغ ${formatCurrency(remaining)} بعنوان أتعاب الملف عدد ${ref} لا يزال متخلّداً بذمتكم. نرجو التفضل بتسويته في أقرب الآجال أو الاتصال بالمكتب لضبط جدول خلاص.\n\nمع فائق الاحترام،\n${user.name}`;
}

function planWrite(intent: WriteIntent, parsed: ParsedMessage, ctx: EngineContext, db: DemoDatabase, user: TeamMember, now: Date): EngineResponse {
  const action: PendingAction = { id: newId("action"), intent, status: "draft", fields: {}, inferences: [], ambiguities: [] };
  const permission = WRITE_PERMISSIONS[intent];
  if (!can(user, permission)) {
    action.blockedReason = PERMISSION_DENIED_MESSAGES[permission];
    return { intent, text: "لا يمكنني إعداد هذا الإجراء بصلاحياتك الحالية.", blocks: [{ type: "action" }], action, memory: {} };
  }

  const resolution = resolveCase(parsed, ctx, db, user);
  const memory: ConversationMemory = {};
  const f = action.fields;
  if (resolution.status === "resolved") {
    memory.lastCaseId = resolution.legalCase.id;
    if (resolution.note && intent !== "create_task") action.inferences.push(`القضية: ${resolution.note}`);
  } else if (resolution.status === "ambiguous") {
    action.ambiguities.push(caseChoiceText(resolution.candidates));
  } else if (resolution.status === "not_found") {
    action.ambiguities.push(notFoundText(resolution.mention));
  }
  if (parsed.dateIssue) action.ambiguities.push(parsed.dateIssue);
  const assignee = getTeam().find((m) => new RegExp(`(^|\\s|ل|و)${fold(m.shortName)}(\\s|$)`).test(parsed.folded));

  switch (intent) {
    case "create_hearing": {
      if (resolution.status === "resolved") f.caseId = resolution.legalCase.id;
      if (parsed.date) {
        f.date = parsed.date.iso;
        action.inferences.push(...parsed.date.notes.filter((n) => n.startsWith("لم")).map((n) => `التاريخ: ${n}`));
      }
      if (parsed.time) {
        f.time = parsed.time.value;
        action.inferences.push(...parsed.time.notes);
      }
      f.hearingType = parsed.hearingType ?? "جلسة استماع";
      if (!parsed.hearingType) action.inferences.push("نوع الجلسة غير مذكور: اعتُبرت «جلسة استماع» (قابل للتعديل)");
      f.court = "قصر العدالة بتونس";
      f.room = "تُحدَّد لاحقاً";
      if (f.date && f.date < toISODate(now)) action.ambiguities.push("التاريخ المحدد في الماضي.");
      break;
    }
    case "update_hearing": {
      const { hearing, note } = resolveHearing({ ...parsed, refersToHearing: parsed.refersToHearing ?? "next" }, resolution, ctx, db, user, now);
      if (hearing) {
        f.hearingId = hearing.id;
        f.caseId = db.cases.find((c) => c.ref === hearing.caseRef)?.id;
        if (note) action.inferences.push(`الجلسة: ${note}`);
        f.date = parsed.date?.iso ?? hearing.date;
        f.time = parsed.time?.value ?? hearing.time;
        memory.lastHearingId = hearing.id;
      } else {
        action.ambiguities.push("لم أحدد الجلسة المطلوب تعديلها: اذكر القضية أو اختر الجلسة.");
      }
      if (!parsed.date && !parsed.time) action.ambiguities.push("لم يُذكر الموعد الجديد.");
      break;
    }
    case "create_reminder": {
      const { hearing, note } = parsed.refersToHearing || parsed.offsetDays ? resolveHearing({ ...parsed, refersToHearing: parsed.refersToHearing ?? "next" }, resolution, ctx, db, user, now) : {};
      if (hearing) {
        f.hearingId = hearing.id;
        f.caseId = db.cases.find((c) => c.ref === hearing.caseRef)?.id;
        memory.lastHearingId = hearing.id;
        if (note) action.inferences.push(`الجلسة: ${note}`);
        const offset = parsed.offsetDays ?? 1;
        if (!parsed.offsetDays) action.inferences.push("لم تُحدَّد المدة: التذكير قبل الجلسة بيوم واحد");
        f.offsetDays = offset;
        f.date = toISODate(addDays(parseISODate(hearing.date), -offset));
        f.title = parsed.title ?? `التذكير بـ${hearing.type} — ${hearing.client} (${formatArabicDate(hearing.date)} ${hearing.time})`;
        if (f.date < toISODate(now)) action.ambiguities.push("تاريخ التذكير المحسوب مضى بالفعل؛ اختر تاريخاً آخر.");
      } else {
        if (parsed.offsetDays) action.ambiguities.push("لم أجد الجلسة المقصودة لحساب موعد التذكير.");
        if (resolution.status === "resolved") f.caseId = resolution.legalCase.id;
        if (parsed.date) {
          f.date = parsed.date.iso;
          action.inferences.push(...parsed.date.notes.map((n) => `التاريخ: ${n}`));
        }
        f.title = parsed.title;
      }
      f.time = parsed.time?.value ?? "09:00";
      if (!parsed.time) action.inferences.push("الساعة غير مذكورة: 09:00 صباحاً افتراضياً");
      f.assigneeId = assignee?.id ?? user.id;
      f.channels = { inApp: true, email: false, sms: false };
      f.priority = parsed.priority ?? "medium";
      f.recurrence = parsed.recurrence ?? "none";
      break;
    }
    case "create_task": {
      f.title = parsed.title;
      if (resolution.status === "resolved" && (parsed.deicticCase || parsed.caseRef || matchClients(parsed.folded, [resolution.legalCase]).length || ctx.caseId)) {
        f.caseId = resolution.legalCase.id;
      }
      if (parsed.date) {
        f.date = parsed.date.iso;
        action.inferences.push(...parsed.date.notes.map((n) => `التاريخ: ${n}`));
      }
      if (/قبل/.test(parsed.folded) && parsed.date) {
        f.date = toISODate(addDays(parseISODate(parsed.date.iso), -1));
        action.inferences.push("«قبل» اليوم المذكور: موعد الإنجاز في اليوم السابق");
      }
      f.time = parsed.time?.value;
      f.assigneeId = assignee?.id ?? user.id;
      if (assignee) action.inferences.push(`المكلّف: ${assignee.name}`);
      f.priority = parsed.priority ?? "medium";
      f.recurrence = parsed.recurrence ?? "none";
      f.channels = { inApp: true, email: false, sms: false };
      break;
    }
    case "draft_payment_reminder":
    case "draft_receipt": {
      const payments = accessiblePayments(db, user).filter((p) => p.remaining > 0);
      const payment = resolution.status === "resolved" ? payments.find((p) => p.caseRef === resolution.legalCase.ref) : undefined;
      if (resolution.status === "resolved" && !payment) {
        action.ambiguities.push(`لا توجد مستحقات متبقية في ملف ${resolution.legalCase.client}.`);
      } else if (resolution.status === "none") {
        action.ambiguities.push(`حدّد الحريف: الملفات ذات المستحقات المتبقية هي ${payments.map((p) => p.client).join("، ") || "—"}.`);
      }
      if (payment) {
        f.paymentId = payment.id;
        f.caseId = db.cases.find((c) => c.ref === payment.caseRef)?.id;
        if (intent === "draft_payment_reminder") {
          f.text = paymentReminderText(payment.client, payment.caseRef, payment.remaining, user);
          action.inferences.push("لن تُرسل الرسالة آلياً: الإرسال يتطلب ربط خدمة بريد أو رسائل قصيرة.");
        } else {
          if (parsed.amount) f.amount = parsed.amount;
          else action.inferences.push(`المبلغ غير مذكور — المتبقي المستحق ${formatCurrency(payment.remaining)}`);
          if (parsed.amount && parsed.amount > payment.remaining) action.ambiguities.push(`المبلغ يتجاوز المتبقي (${formatCurrency(payment.remaining)}).`);
        }
      }
      if (intent === "draft_receipt") {
        f.date = parsed.date?.iso ?? toISODate(now);
        f.receiptNumber = nextReceiptNumber(db, now);
        action.inferences.push(`رقم الوصل يُسند تلقائياً بالتسلسل: ${f.receiptNumber}`);
      }
      break;
    }
  }

  const missing = missingFields(action);
  const label = ACTION_TITLES[intent];
  const text = missing.length
    ? `جهّزت معاينة «${label}». تنقصني: ${missing.map((m) => FIELD_LABELS[m]).join("، ")}. أكمِلها في البطاقة أو اكتبها في رسالة، ولن يُحفظ أي شيء قبل تأكيدك.`
    : `جهّزت معاينة «${label}». راجع التفاصيل ثم أكّد — لن يُحفظ أي شيء قبل تأكيدك.`;
  return { intent, text, blocks: [{ type: "action" }], action, memory };
}

/** Merges a follow-up message ("على الساعة 10", "مع ملف مراد") into a pending draft action. */
function mergeIntoPending(pending: PendingAction, parsed: ParsedMessage, ctx: EngineContext, db: DemoDatabase, user: TeamMember): EngineResponse | null {
  const strongNewIntent = parsed.intent !== "unknown" && parsed.intent !== pending.intent && (parsed.scores[parsed.intent] ?? 0) >= 3.3;
  if (strongNewIntent) return null;
  const resolution = resolveCase(parsed, { ...ctx, caseId: undefined, memory: {} }, db, user);
  const hasEntity = parsed.date || parsed.time || resolution.status === "resolved" || parsed.amount || parsed.hearingType;
  if (!hasEntity) return null;
  const next: PendingAction = {
    ...pending,
    id: newId("action"),
    fields: { ...pending.fields },
    inferences: [...pending.inferences],
    ambiguities: [],
  };
  const f = next.fields;
  if (parsed.date) {
    if (pending.intent === "create_reminder" && pending.fields.hearingId && !parsed.offsetDays) f.offsetDays = undefined;
    f.date = parsed.date.iso;
    next.inferences.push(...parsed.date.notes.filter((n) => n.startsWith("لم")).map((n) => `التاريخ: ${n}`));
  }
  if (parsed.time) f.time = parsed.time.value;
  if (parsed.hearingType) f.hearingType = parsed.hearingType;
  if (parsed.amount) f.amount = parsed.amount;
  if (resolution.status === "resolved") {
    f.caseId = resolution.legalCase.id;
    if (pending.intent === "draft_receipt" || pending.intent === "draft_payment_reminder") {
      const payment = accessiblePayments(db, user).find((p) => p.caseRef === resolution.legalCase.ref && p.remaining > 0);
      f.paymentId = payment?.id;
      if (payment && pending.intent === "draft_payment_reminder") f.text = paymentReminderText(payment.client, payment.caseRef, payment.remaining, user);
    }
  }
  const missing = missingFields(next);
  return {
    intent: pending.intent,
    text: missing.length
      ? `حدّثت المعاينة. ما زال ينقص: ${missing.map((m) => FIELD_LABELS[m]).join("، ")}.`
      : "حدّثت المعاينة بالمعطيات الجديدة. راجعها ثم أكّد.",
    blocks: [{ type: "action" }],
    action: next,
    memory: resolution.status === "resolved" ? { lastCaseId: resolution.legalCase.id } : {},
    supersedes: pending.id,
  };
}

// ——— Entry point ———

export function respond(message: string, ctx: EngineContext, db: DemoDatabase = getDB(), user: TeamMember = currentUser(db)): EngineResponse {
  const now = ctx.now ?? new Date();
  const parsed = parseMessage(message, now);

  if (ctx.pendingAction?.status === "draft") {
    const merged = mergeIntoPending(ctx.pendingAction, parsed, ctx, db, user);
    if (merged) return merged;
  }

  if (isWriteIntent(parsed.intent)) return planWrite(parsed.intent, parsed, ctx, db, user, now);

  const resolution = resolveCase(parsed, ctx, db, user);
  switch (parsed.intent) {
    case "list_upcoming_hearings":
      return listHearings(parsed, db, user, now);
    case "check_hearing_conflicts":
      return checkConflicts(db, user, now);
    case "query_unpaid_fees":
      return unpaidFees(parsed.mentionText || parsed.caseRef || parsed.deicticCase ? resolution : { status: "none" }, db, user);
    case "summarize_case":
      return summarizeCase(resolution, db, user, now);
    case "prepare_hearing":
      return prepareHearing(resolution, parsed, ctx, db, user, now);
    case "search_archive":
      return searchArchive(parsed, db, user);
    case "archive_status":
      return archiveStatus(db, user);
    case "compare_cases":
      return compareCases(resolution, db, user, now);
    case "search_case":
      return searchCase(resolution, db, user, now);
    case "help":
      return { intent: "help", text: "يمكنني مساعدتك في المهام التالية، مع الاعتماد حصرياً على بيانات المكتب المصرّح لك بها:", blocks: [{ type: "list", items: HELP_ITEMS.map((t, i) => ({ id: `help-${i}`, title: t })) }], memory: {} };
    default: {
      if (resolution.status === "resolved" && parsed.mentionText) return searchCase(resolution, db, user, now);
      return {
        intent: "unknown",
        text: "لم أفهم الطلب بدقة. يمكنك إعادة صياغته، أو تجربة أحد الأمثلة التالية:",
        blocks: [{ type: "list", items: HELP_ITEMS.slice(0, 4).map((t, i) => ({ id: `ex-${i}`, title: t })) }],
        memory: {},
      };
    }
  }
}
