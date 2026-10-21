/**
 * Rule-based intent & entity extraction for formal Arabic and Tunisian dialect.
 *
 * This is deterministic on purpose: it runs locally, never invents values, and records
 * every inference (month, year, default hour…) so the confirmation preview can show it.
 * A production LLM can replace `detectIntent` behind the same `ParsedMessage` contract,
 * but entity validation, authorisation and confirmation must stay server-side.
 */
import type { TaskPriority, TaskRecurrence } from "@/types";
import { toLatinDigits } from "@/lib/arabic";
import { addDays, startOfDay, toISODate } from "@/lib/dates";
import { arabicMonths } from "@/lib/formatters";
import type { Intent } from "@/services/assistant/types";

/** Folds letters and digits but keeps punctuation (needed for dates, times and references). */
export function fold(text: string): string {
  return toLatinDigits(text)
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[؟?!،,]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const f = (words: string[]) => words.map(fold);
const any = (words: string[]) => new RegExp(f(words).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));

export interface ParsedDate {
  iso: string;
  notes: string[];
}

export interface ParsedMessage {
  intent: Intent;
  scores: Partial<Record<Intent, number>>;
  folded: string;
  date?: ParsedDate;
  dateIssue?: string;
  range?: { from: string; to: string; label: string };
  time?: { value: string; notes: string[] };
  offsetDays?: number;
  refersToHearing?: "next" | "previous";
  caseRef?: string;
  deicticCase: boolean;
  caseType?: string;
  mentionText?: string;
  hearingType?: string;
  assigneeName?: string;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence;
  amount?: number;
  year?: string;
  docType?: string;
  searchQuery: string;
  title?: string;
  withSummary: boolean;
}

// ——— Intent rules ———

const V = {
  record: any(["سجل", "سجّل", "برمج", "زيد", "اضف", "أضف", "حط", "عين", "حدد", "ثبت", "اعمل", "أعمل", "خلي"]),
  hearing: any(["جلسه", "جلسة", "audience"]),
  reschedule: any(["اجل", "أجّل", "اخر", "أخّر", "بدل", "بدّل", "غير الموعد", "غيّر", "نقل", "عدل", "عدّل", "حول", "حوّل"]),
  hearingsList: any(["الجلسات", "جلسات", "جلساتي", "المواعيد", "مواعيدي", "الرزنامه", "الأجندة", "الاجنده"]),
  ask: any(["شنوه", "شنوّة", "شنيه", "اشنوه", "اش", "ما هي", "ماهي", "وريني", "ورّيني", "اعطيني", "عطيني", "عندي", "قداش", "اذكر", "لائحه", "قائمه", "شكون", "اعرض"]),
  summary: any(["ملخص", "لخص", "لخّص", "تلخيص", "خلاصه", "شنوه صار", "وين وصل", "اين وصل", "حاله الملف", "وضعيه الملف"]),
  myCases: any(["القضايا اللي عندي", "قضاياي", "ملفاتي", "القضايا متاع", "الجلسات"]),
  conflict: any(["تعارض", "تضارب", "تداخل", "متزامن", "في نفس الوقت", "نفس التوقيت", "conflict"]),
  remind: any(["ذكرني", "ذكّرني", "فكرني", "فكّرني", "نبهني", "نبّهني", "ذكرلي", "تذكير", "منبه"]),
  task: any(["مهمه", "مهمة", "مهام", "تاسك", "كلف", "كلّف"]),
  prepare: any(["حضر", "حضّر", "جهز", "جهّز", "تحضير"]),
  argue: any(["حجج", "حجه", "حجة", "دفوع", "دفع قانوني", "مرافعه", "استراتيجيه", "نقاط قانونيه", "مذكره تحضيريه", "مذكرة تحضيرية", "اقترح"]),
  search: any(["فتش", "فتّش", "ابحث", "بحث", "لوج", "لوّج", "دور", "دوّر", "نلقى", "تلقى", "جيبلي", "جيب لي"]),
  archiveObj: any(["حكم", "احكام", "قرار", "وثيقه", "وثائق", "ارشيف", "أرشيف", "محضر", "مذكره", "قديم", "سابق", "jugement", "arret"]),
  compare: any(["قارن", "مقارنه", "قارنلي", "شبيه", "يشبه", "مشابه"]),
  money: any(["اتعاب", "أتعاب", "مستحق", "فلوس", "خلاص", "تخلص", "تخلّص", "مدفوع", "ديون", "دفع", "دفعه", "مبلغ", "الباقي"]),
  receipt: any(["وصل", "فاتوره", "recu", "reçu"]),
  draftMsg: any(["تذكير", "ذكر", "ذكّر", "رساله", "مكتوب", "نبه", "ابعث", "اكتب", "حضر"]),
  openCase: any(["افتح", "وين ملف", "ملف", "قضيه", "القضيه", "ورّيني ملف"]),
  help: any(["شنوه تنجم", "شنوّة تنجم", "ماذا يمكنك", "مساعده", "help", "كيفاش نستعمل", "شنوة تعمل"]),
};

function scoreIntents(n: string): Partial<Record<Intent, number>> {
  const s: Partial<Record<Intent, number>> = {};
  const add = (intent: Intent, value: number) => (s[intent] = Math.max(s[intent] ?? 0, value));

  if (V.receipt.test(n)) add("draft_receipt", 4.2);
  if (V.money.test(n) && V.draftMsg.test(n) && !V.receipt.test(n)) add("draft_payment_reminder", 4.1);
  if (V.money.test(n)) add("query_unpaid_fees", 2.6);
  if (V.hearing.test(n) && V.reschedule.test(n)) add("update_hearing", 4);
  if (V.hearing.test(n) && V.record.test(n)) add("create_hearing", 3.5);
  if (/جلسه جديده/.test(n)) add("create_hearing", 3.6);
  if (V.hearingsList.test(n) && V.ask.test(n)) add("list_upcoming_hearings", 3.2);
  if (V.summary.test(n) && V.myCases.test(n) && /(غدوه|غدا|اليوم|الاسبوع|السمانه|عندي)/.test(n)) add("list_upcoming_hearings", 4.3);
  if (V.conflict.test(n)) add("check_hearing_conflicts", 4.4);
  if (V.remind.test(n)) add("create_reminder", /اعمل(لي)? تذكير|زيد تذكير/.test(n) ? 3.7 : 3.3);
  if (V.task.test(n)) add("create_task", V.record.test(n) || /جديده/.test(n) ? 3.8 : 2.4);
  if (V.summary.test(n)) add("summarize_case", 3.6);
  if (V.argue.test(n)) add("prepare_hearing", 3.9);
  else if (V.prepare.test(n)) add("prepare_hearing", 2.5);
  if (V.search.test(n) && V.archiveObj.test(n)) add("search_archive", 3.7);
  else if (V.search.test(n)) add("search_archive", 2.2);
  if (/(حكم|قرار|احكام) (قديم|سابق)/.test(n)) add("search_archive", 3.4);
  if (V.compare.test(n)) add("compare_cases", 4.2);
  if (/(الارشفه|ارشفه|دفعات الارشيف|دفعه ارشفه|دفعات الارشفه)/.test(n) && /(حاله|وين|شنوه|تقدم|وضعيه|اش)/.test(n)) add("archive_status", 4.5);
  if (V.openCase.test(n)) add("search_case", 1.4);
  if (V.help.test(n)) add("help", 3.5);
  return s;
}

function pickIntent(scores: Partial<Record<Intent, number>>): Intent {
  let best: Intent = "unknown";
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores) as [Intent, number][]) {
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

// ——— Dates ———

const MONTHS: [RegExp, number][] = [
  [any(["جانفي", "يناير", "janvier", "كانون الثاني"]), 0],
  [any(["فيفري", "فبراير", "fevrier", "février", "شباط"]), 1],
  [any(["مارس", "mars", "اذار"]), 2],
  [any(["افريل", "أفريل", "ابريل", "أبريل", "avril", "نيسان"]), 3],
  [any(["ماي", "مايو", "mai", "ايار"]), 4],
  [any(["جوان", "يونيو", "يونيه", "juin", "حزيران"]), 5],
  [any(["جويليه", "جويلية", "يوليو", "يوليه", "juillet", "تموز"]), 6],
  [any(["اوت", "أوت", "اغسطس", "أغسطس", "aout", "août", "اب"]), 7],
  [any(["سبتمبر", "septembre", "ايلول"]), 8],
  [any(["اكتوبر", "أكتوبر", "octobre", "تشرين الاول"]), 9],
  [any(["نوفمبر", "novembre", "تشرين الثاني"]), 10],
  [any(["ديسمبر", "decembre", "décembre", "كانون الاول"]), 11],
];

const WEEKDAYS: [RegExp, number][] = [
  [/(الاحد|لاحد)/, 0],
  [/(الاثنين|الاثنين|الثنين|لثنين)/, 1],
  [/(الثلاثاء|الثلاثا|التلات|الثلاث\b)/, 2],
  [/(الاربعاء|الاربعا|لاربعا)/, 3],
  [/(الخميس|لخميس)/, 4],
  // "نهار الجمعة" is a Friday; a bare "الجمعة الجاية" means "next week" in Tunisian usage.
  [/(?:نهار|يوم|ليوم) الجمعه|الجمعه(?! الجايه| القادمه| الماضيه| الفارطه)/, 5],
  [/(السبت|سبت)/, 6],
];

const NUMBER_WORDS: Record<string, number> = {
  [fold("يوم")]: 1, [fold("نهار")]: 1, [fold("يومين")]: 2, [fold("نهارين")]: 2,
  [fold("ثلاثة")]: 3, [fold("ثلاث")]: 3, [fold("تلاثة")]: 3, [fold("أربعة")]: 4, [fold("اربعة")]: 4,
  [fold("خمسة")]: 5, [fold("ستة")]: 6, [fold("أسبوع")]: 7, [fold("جمعة")]: 7, [fold("سمانة")]: 7,
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function monthName(m: number) {
  return arabicMonths[m];
}

export function parseDate(n: string, now: Date): { date?: ParsedDate; issue?: string } {
  const today = startOfDay(now);
  const notes: string[] = [];

  const iso = n.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), notes);

  const numeric = n.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (numeric && !/\b[a-z]{2}\/\d{4}/.test(n)) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]) - 1;
    let y = numeric[3] ? Number(numeric[3]) : NaN;
    if (y && y < 100) y += 2000;
    return withYear(d, m, Number.isNaN(y) ? undefined : y);
  }

  for (const [rx, month] of MONTHS) {
    const m = n.match(new RegExp(`(\\d{1,2})\\s*(?:من\\s*)?(?:شهر\\s*)?(?:${rx.source})(?:\\s*(\\d{4}))?`));
    if (m) return withYear(Number(m[1]), month, m[2] ? Number(m[2]) : undefined);
  }

  const monthNum = n.match(/(\d{1,2})\s*(?:من\s*)?شهر\s*(\d{1,2})(?:\s*(\d{4}))?/);
  if (monthNum) return withYear(Number(monthNum[1]), Number(monthNum[2]) - 1, monthNum[3] ? Number(monthNum[3]) : undefined);

  if (/بعد غدو?[هاة]?|بعد غد/.test(n)) return { date: { iso: toISODate(addDays(today, 2)), notes: ["بعد غد"] } };
  if (/غدو[هاة]?|\bغدا\b|غداً/.test(n)) return { date: { iso: toISODate(addDays(today, 1)), notes: ["غداً"] } };
  if (/اليوم|ليوم|توا\b/.test(n) && !/الايام/.test(n)) return { date: { iso: toISODate(today), notes: ["اليوم"] } };

  const after = n.match(/بعد\s*(\d+|[؀-ۿ]+)\s*(ايام|يام|يوم|نهار|اسابيع|جمعات)?/);
  if (after) {
    const qty = /^\d+$/.test(after[1]) ? Number(after[1]) : NUMBER_WORDS[after[1]];
    if (qty) {
      const unit = after[2] && /اسابيع|جمعات/.test(after[2]) ? 7 : 1;
      const days = NUMBER_WORDS[after[1]] === 7 && !after[2] ? 7 : qty * unit;
      return { date: { iso: toISODate(addDays(today, days)), notes: [`بعد ${days} أيام من اليوم`] } };
    }
  }

  for (const [rx, weekday] of WEEKDAYS) {
    if (rx.test(n)) {
      let delta = (weekday - today.getDay() + 7) % 7;
      if (delta === 0) {
        delta = 7;
        notes.push("اليوم يوافق نفس اليوم: اعتُبر موعد الأسبوع القادم");
      }
      notes.push(`أقرب يوم ${["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"][weekday]} قادم`);
      return { date: { iso: toISODate(addDays(today, delta)), notes } };
    }
  }

  const dayOnly = n.match(/(?:نهار|يوم|بتاريخ|ليوم|في)\s*(\d{1,2})(?!\s*[:h]|\d|\s*(?:ايام|يام|يوم|دينار|د\b|الف|ساعه))/);
  if (dayOnly) {
    const d = Number(dayOnly[1]);
    let month = today.getMonth();
    let year = today.getFullYear();
    if (d < today.getDate()) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    notes.push(`لم يُذكر الشهر: اعتُبر شهر ${monthName(month)} ${year}`);
    return build(year, month, d, notes);
  }

  return {};

  function withYear(d: number, m: number, y?: number) {
    if (m < 0 || m > 11) return { issue: "الشهر المذكور غير صالح." };
    if (y) return build(y, m, d, notes);
    let year = today.getFullYear();
    const candidate = new Date(year, m, Math.min(d, daysInMonth(year, m)));
    if (candidate < today) {
      year += 1;
      notes.push(`لم تُذكر السنة: اعتُبرت سنة ${year} لأن التاريخ مضى هذه السنة`);
    } else {
      notes.push(`لم تُذكر السنة: اعتُبرت سنة ${year}`);
    }
    return build(year, m, d, notes);
  }

  function build(y: number, m: number, d: number, n2: string[]) {
    if (d < 1 || d > daysInMonth(y, m)) {
      return { issue: `اليوم ${d} غير موجود في شهر ${monthName(m)} ${y}.` };
    }
    return { date: { iso: toISODate(new Date(y, m, d)), notes: n2 } };
  }
}

export function parseRange(n: string, now: Date): { from: string; to: string; label: string } | undefined {
  const today = startOfDay(now);
  const dow = today.getDay();
  if (/الاسبوع (الجاي|القادم|المقبل|الجايه)|السمانه الجايه|(?<!نهار |يوم )الجمعه الجايه/.test(n)) {
    const toMonday = ((8 - dow) % 7) || 7;
    const from = addDays(today, toMonday);
    return { from: toISODate(from), to: toISODate(addDays(from, 6)), label: "الأسبوع القادم" };
  }
  if (/هذا الاسبوع|الاسبوع هذا|هالاسبوع|السمانه هذي|هالسمانه|الاسبوع الحالي/.test(n)) {
    const toSunday = (7 - dow) % 7;
    return { from: toISODate(today), to: toISODate(addDays(today, toSunday)), label: "هذا الأسبوع" };
  }
  if (/الشهر (الجاي|القادم|المقبل)/.test(n)) {
    const from = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return { from: toISODate(from), to: toISODate(to), label: "الشهر القادم" };
  }
  if (/بعد غدو?[هاة]?|بعد غد/.test(n)) {
    const d = toISODate(addDays(today, 2));
    return { from: d, to: d, label: "بعد غد" };
  }
  if (/غدو[هاة]?|\bغدا\b/.test(n)) {
    const d = toISODate(addDays(today, 1));
    return { from: d, to: d, label: "غداً" };
  }
  if (/اليوم/.test(n)) {
    const d = toISODate(today);
    return { from: d, to: d, label: "اليوم" };
  }
  return undefined;
}

// ——— Time ———

export function parseTime(n: string): { value: string; notes: string[] } | undefined {
  const notes: string[] = [];
  let hour: number | undefined;
  let minute = 0;

  const clock = n.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  const spoken = n.match(/(?:على|عال|ع)?\s*(?:الساعه|ساعه|الساعة)\s*(\d{1,2})(?:[:h.](\d{2}))?(?:\s*(?:و\s*)?(نص|نصف|ربع|ثلث|الا ربع|غير ربع))?/);
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
  } else if (spoken) {
    hour = Number(spoken[1]);
    if (spoken[2]) minute = Number(spoken[2]);
    const frac = spoken[3];
    if (frac === "نص" || frac === "نصف") minute = 30;
    else if (frac === "ربع") minute = 15;
    else if (frac === "ثلث") minute = 20;
    else if (frac && /الا ربع|غير ربع/.test(frac)) {
      hour -= 1;
      minute = 45;
    }
  } else {
    return undefined;
  }
  if (hour === undefined || hour > 23) return undefined;
  const pm = /(العشيه|عشيه|مساء|المساء|بعد الظهر|العصر|بالليل)/.test(n);
  const am = /(الصباح|صباحا|الصبح|صباح)/.test(n);
  if (pm && hour < 12) hour += 12;
  else if (!am && hour >= 1 && hour <= 6) {
    hour += 12;
    notes.push(`اعتُبرت الساعة ${hour}:${String(minute).padStart(2, "0")} بعد الظهر`);
  }
  return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, notes };
}

function parseOffset(n: string): number | undefined {
  const m = n.match(/قبل(?:ها|ه|و)?(?:\s+(?:الجلسه|الموعد|بالجلسه|جلسه))?\s+ب?\s*(\d+|[؀-ۿ]+)(?:\s*(ايام|يام|يوم|نهار|نهارات))?/);
  if (!m) return undefined;
  const token = m[1].replace(/^ب/, "");
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? NUMBER_WORDS[m[1]];
}

// ——— Other entities ———

const DEICTIC_CASE = /((ال|لل|ل|ب)?ملف (هذا|هاذا|هذي)|هالملف|هذا الملف|(ال|لل|ل|ب)?قضيه (هذي|هاذي|هذه|هاذه)|هالقضيه|هذه القضيه|القضيه الحاليه|الملف الحالي)/;
const NEXT_HEARING = /(الجلسه (الجايه|القادمه|المقبله|الجاية)|جلستي الجايه|اقرب جلسه|الجلسه اللي جايه)/;
const CASE_TYPES: [RegExp, string][] = [
  [/(ميراث|ارث|تركه|الورث)/, "نزاع ميراث"],
  [/(قضيه|ملف|نزاع) (ال)?مدني/, "قضية مدنية"],
  [/(قضيه|ملف|نزاع) (ال)?تجاري/, "قضية تجارية"],
  [/(قضيه|ملف|نزاع) (ال)?عقاري/, "قضية عقارية"],
  [/طعن|تعقيب/, "طعن تعقيبي"],
];
const HEARING_TYPES: [RegExp, string][] = [
  [/مرافعه/, "جلسة مرافعة"],
  [/استماع/, "جلسة استماع"],
  [/جلسه (حكم|التصريح بالحكم)/, "جلسة حكم"],
  [/صلحي/, "جلسة صلحية"],
  [/تحضيري/, "جلسة تحضيرية"],
];

const SEARCH_NOISE = new Set(
  f([
    "فتشلي", "فتّشلي", "فتش", "ابحث", "ابحثلي", "بحث", "لوجلي", "لوج", "دورلي", "دور", "جيبلي", "على", "عن", "في", "متاع",
    "سنة", "سنه", "قديم", "قديمة", "سابق", "سابقة", "وثيقة", "وثائق", "الأرشيف", "ارشيف", "الارشيف", "حكم", "الحكم", "أحكام",
    "احكام", "قرار", "نزاع", "قضية", "قضايا", "اللي", "خاص", "بال", "لي", "نحب", "من", "مع", "و", "شوية", "برشا", "محضر", "مذكرة",
  ]),
);

function extractTitle(raw: string, intent: Intent): string | undefined {
  const text = toLatinDigits(raw).replace(/[؟?!]/g, "").trim();
  const bash = text.match(/(?:باش|بش|لكي|حتى|ب\s?ش)\s+(.+)/);
  let candidate = bash
    ? bash[1]
    : text.replace(/^(ذ?كّ?رني|ذكرني|فكّ?رني|نبّ?هني|اعمل(لي)?\s+(تذكير|مهمّ?ة)|زيد\s+(تذكير|مهمّ?ة)|سجّ?ل(لي)?\s+مهمّ?ة|أضف\s+مهمّ?ة|مهمّ?ة\s+جديدة:?)\s*/u, "");
  candidate = candidate
    .split(/\s(?:نهار|يوم|غدوة|غدوه|غدا|بعد غدوة|على الساعة|عالساعة|الساعة|قبل|في\s+\d|ب?تاريخ|الأسبوع|كل)\s?/u)[0]
    .trim();
  if (!candidate || candidate.length < 3) return undefined;
  if (intent === "create_reminder" && /^(بموعد|ب?الجلسة|بالموعد)/u.test(candidate)) return undefined;
  return candidate.length > 120 ? `${candidate.slice(0, 117)}…` : candidate;
}

export function parseMessage(raw: string, now: Date = new Date()): ParsedMessage {
  const n = fold(raw);
  const scores = scoreIntents(n);
  const intent = pickIntent(scores);

  const { date, issue } = parseDate(n, now);
  const range = parseRange(n, now);
  const time = parseTime(n);
  const refMatch = raw.match(/\b([A-Z]{2})\s*\/\s*(\d{4})\s*\/\s*(\d{3,4})\b/i);
  const caseType = CASE_TYPES.find(([rx]) => rx.test(n))?.[1];
  const mention = n.match(/(?:ملف|قضيه|عائله|الحريف|حريف|متاع|للحريف)\s+((?:[؀-ۿ]+\s?){1,3})/);
  const yearMatch = n.replace(/\b[a-z]{2}\/\d{4}\/\d{3,4}\b/g, "").match(/\b(19\d{2}|20\d{2})\b/);
  const amountMatch = n.match(/(\d+(?:[.,]\d+)?)\s*(الاف|الف|ألف|دينار|د\.ت|د ت|dt|tnd)/);

  let amount: number | undefined;
  if (amountMatch) {
    amount = Number(amountMatch[1].replace(",", "."));
    if (/الف|الاف/.test(amountMatch[2])) amount *= 1000;
  }

  let docType: string | undefined;
  if (/\bحكم\b|الحكم|احكام/.test(n)) docType = "حكم قضائي";
  else if (/محضر/.test(n)) docType = "محضر جلسة";
  else if (/مذكره/.test(n) && intent === "search_archive") docType = "مذكرة دفاع";

  const searchQuery = n
    .replace(/\b[a-z]{2}\/\d{4}\/\d{3,4}\b/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^(و|ف)?(ال)?/, (m) => (w.length - m.length >= 3 ? "" : m)))
    .filter((w) => w && !SEARCH_NOISE.has(w) && !SEARCH_NOISE.has(`ال${w}`) && !/^(19|20)\d{2}$/.test(w))
    .join(" ")
    .trim();

  const priority: TaskPriority | undefined = /(موش|مش|ماهوش) مستعجل/.test(n)
    ? "low"
    : /(عاجل|مستعجل|ضروري|اولويه عاليه|urgent)/.test(n)
      ? "high"
      : undefined;
  const recurrence: TaskRecurrence | undefined = /(كل يوم|يوميا)/.test(n)
    ? "daily"
    : /(كل اسبوع|كل جمعه|اسبوعيا|كل سمانه)/.test(n)
      ? "weekly"
      : /(كل شهر|شهريا)/.test(n)
        ? "monthly"
        : undefined;

  return {
    intent,
    scores,
    folded: n,
    date,
    dateIssue: issue,
    range,
    time,
    offsetDays: parseOffset(n),
    refersToHearing: /قبلها|بعدها|نفس الجلسه/.test(n) ? "previous" : NEXT_HEARING.test(n) || /(الجلسه|بموعد الجلسه|موعد الجلسه)/.test(n) ? "next" : undefined,
    caseRef: refMatch ? `${refMatch[1].toUpperCase()}/${refMatch[2]}/${refMatch[3]}` : undefined,
    deicticCase: DEICTIC_CASE.test(n),
    caseType,
    mentionText: mention?.[1]?.trim(),
    hearingType: HEARING_TYPES.find(([rx]) => rx.test(n))?.[1],
    assigneeName: undefined,
    priority,
    recurrence,
    amount,
    year: yearMatch?.[1],
    docType,
    searchQuery,
    title: intent === "create_task" || intent === "create_reminder" ? extractTitle(raw, intent) : undefined,
    withSummary: V.summary.test(n),
  };
}
