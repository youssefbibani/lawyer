import { describe, it, expect } from "vitest";

import { parseMessage } from "@/services/assistant/intent";

// Sunday 18 October 2026, 10:00
const NOW = new Date(2026, 9, 18, 10, 0);

describe("intent detection (Tunisian dialect & formal Arabic)", () => {
  it.each([
    ["سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح", "create_hearing"],
    ["أجّل جلسة بن صالح لنهار 25 نوفمبر", "update_hearing"],
    ["ذكّرني قبل الجلسة بيومين", "create_reminder"],
    ["اعمل تذكير باش نكلّم الحريف نهار الجمعة", "create_reminder"],
    ["سجّل مهمة باش أمينة تجيب شهادة الملكية نهار الخميس", "create_task"],
    ["فتّشلي على حكم قديم في نزاع ميراث", "search_archive"],
    ["فتّشلي على الحكم متاع سنة 2019", "search_archive"],
    ["حضّرلي ملخص للقضية متاع عائلة بن صالح", "summarize_case"],
    ["اقترح حجج قانونية للملف هذا", "prepare_hearing"],
    ["حضّرلي الحجج اللي تنجم تعاون في قضية الميراث", "prepare_hearing"],
    ["شنوة الجلسات اللي عندي الأسبوع الجاي؟", "list_upcoming_hearings"],
    ["اعطيني ملخص على القضايا اللي عندي غدوة", "list_upcoming_hearings"],
    ["عندي تعارض في الجلسات؟", "check_hearing_conflicts"],
    ["ورّيني الأتعاب اللي مازالت ما تخلّصتش", "query_unpaid_fees"],
    ["حضّرلي تذكير بالخلاص لسامي مراد", "draft_payment_reminder"],
    ["اعمل وصل خلاص لسامي مراد بـ 1000 دينار", "draft_receipt"],
    ["قارن قضية بن صالح مع القضايا القديمة", "compare_cases"],
  ])("«%s» → %s", (text, intent) => {
    expect(parseMessage(text, NOW).intent).toBe(intent);
  });

  it("resolves a day + month without a year to the next occurrence and records the inference", () => {
    const p = parseMessage("سجّللي جلسة نهار 11 نوفمبر", NOW);
    expect(p.date?.iso).toBe("2026-11-11");
    expect(p.date?.notes.join(" ")).toContain("لم تُذكر السنة");
  });

  it("rolls a past month to the following year", () => {
    expect(parseMessage("جلسة 5 مارس", NOW).date?.iso).toBe("2027-03-05");
  });

  it("resolves a bare day number to this month or next month, never silently", () => {
    const later = parseMessage("سجّللي جلسة نهار 25", NOW);
    expect(later.date?.iso).toBe("2026-10-25");
    const past = parseMessage("سجّللي جلسة نهار 11", NOW);
    expect(past.date?.iso).toBe("2026-11-11");
    expect(past.date?.notes.join(" ")).toContain("لم يُذكر الشهر");
    const december = parseMessage("نهار 3", new Date(2026, 11, 20));
    expect(december.date?.iso).toBe("2027-01-03");
  });

  it("rejects impossible dates instead of guessing", () => {
    const p = parseMessage("سجّللي جلسة نهار 31 نوفمبر", NOW);
    expect(p.date).toBeUndefined();
    expect(p.dateIssue).toContain("غير موجود");
  });

  it("parses relative dates and weekdays", () => {
    expect(parseMessage("غدوة", NOW).date?.iso).toBe("2026-10-19");
    expect(parseMessage("بعد غدوة", NOW).date?.iso).toBe("2026-10-20");
    expect(parseMessage("نهار الجمعة", NOW).date?.iso).toBe("2026-10-23");
    expect(parseMessage("بعد 3 أيام", NOW).date?.iso).toBe("2026-10-21");
  });

  it("parses 'next week' as the following Monday–Sunday range", () => {
    const p = parseMessage("شنوة الجلسات اللي عندي الأسبوع الجاي؟", NOW);
    expect(p.range).toEqual({ from: "2026-10-19", to: "2026-10-25", label: "الأسبوع القادم" });
  });

  it("parses Tunisian time expressions", () => {
    expect(parseMessage("على الساعة 9 و نص", NOW).time?.value).toBe("09:30");
    expect(parseMessage("الساعة 10:15", NOW).time?.value).toBe("10:15");
    expect(parseMessage("الساعة 3 العشية", NOW).time?.value).toBe("15:00");
    expect(parseMessage("الساعة 11 الا ربع", NOW).time?.value).toBe("10:45");
    const ambiguous = parseMessage("الساعة 2", NOW);
    expect(ambiguous.time?.value).toBe("14:00");
    expect(ambiguous.time?.notes.length).toBeGreaterThan(0);
  });

  it("extracts reminder offsets and hearing references", () => {
    const before = parseMessage("ذكّرني قبل الجلسة بيومين", NOW);
    expect(before.offsetDays).toBe(2);
    expect(before.refersToHearing).toBe("next");
    const anaphora = parseMessage("ذكّرني قبلها بيومين", NOW);
    expect(anaphora.offsetDays).toBe(2);
    expect(anaphora.refersToHearing).toBe("previous");
  });

  it("extracts reminder titles, case references, years and amounts", () => {
    expect(parseMessage("اعمل تذكير باش نكلّم الحريف نهار الجمعة", NOW).title).toBe("نكلّم الحريف");
    expect(parseMessage("وين وصل الملف CC/2025/0398", NOW).caseRef).toBe("CC/2025/0398");
    const search = parseMessage("فتّشلي على الحكم متاع سنة 2019", NOW);
    expect(search.year).toBe("2019");
    expect(search.docType).toBe("حكم قضائي");
    expect(parseMessage("وصل بـ 2 الاف دينار", NOW).amount).toBe(2000);
    expect(parseMessage("اقترح حجج قانونية للملف هذا", NOW).deicticCase).toBe(true);
  });
});
