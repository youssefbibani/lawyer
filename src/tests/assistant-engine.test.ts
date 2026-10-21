import { describe, it, expect, vi, beforeEach } from "vitest";

import { getDB, resetDB } from "@/services/db";
import { switchDemoUser } from "@/services/api";
import { respond, missingFields, type EngineContext } from "@/services/assistant/engine";
import { actionConflicts, actionExecutor } from "@/services/assistant/actions";
import { generateBrief } from "@/services/assistant/brief";
import { wrapUntrustedDocument } from "@/services/assistant/prompt";
import type { AssistantBlock } from "@/services/assistant/types";

const NOW = new Date(2026, 9, 18, 10, 0);
const ctx = (extra: Partial<EngineContext> = {}): EngineContext => ({ memory: {}, now: NOW, ...extra });

function snapshot() {
  const db = getDB();
  return { hearings: db.hearings.length, tasks: db.tasks.length, receipts: db.receipts.length, drafts: db.drafts.length, audit: db.audit.length };
}

function blocksOf<T extends AssistantBlock["type"]>(blocks: AssistantBlock[], type: T) {
  return blocks.filter((b): b is Extract<AssistantBlock, { type: T }> => b.type === type);
}

beforeEach(() => resetDB(NOW));

describe("action planning never writes before confirmation", () => {
  it.each([
    "سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10",
    "ذكّرني قبل الجلسة بيومين",
    "اعمل تذكير باش نكلّم الحريف نهار الجمعة",
    "سجّل مهمة باش أمينة تجيب شهادة الملكية نهار الخميس",
    "حضّرلي تذكير بالخلاص لسامي مراد",
    "اعمل وصل خلاص لسامي مراد بـ 1000 دينار",
    "أجّل جلسة بن صالح لنهار 25 نوفمبر على الساعة 11",
  ])("«%s» only produces a draft preview", (text) => {
    const before = snapshot();
    const res = respond(text, ctx({ caseId: "1" }));
    expect(res.action?.status).toBe("draft");
    expect(snapshot()).toEqual(before);
  });
});

describe("hearing scheduling", () => {
  it("asks for the missing time and records inferred year", () => {
    const res = respond("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح", ctx());
    const action = res.action!;
    expect(action.fields.caseId).toBe("1");
    expect(action.fields.date).toBe("2026-11-11");
    expect(missingFields(action)).toEqual(["time"]);
    expect(action.inferences.join(" ")).toContain("2026");
    expect(res.text).toContain("الساعة");
  });

  it("merges a follow-up message into the pending draft", () => {
    const first = respond("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح", ctx());
    const second = respond("على الساعة 10", ctx({ pendingAction: first.action }));
    expect(second.supersedes).toBe(first.action!.id);
    expect(second.action!.fields.time).toBe("10:00");
    expect(second.action!.fields.caseId).toBe("1");
    expect(missingFields(second.action!)).toEqual([]);
  });

  it("flags unknown cases instead of guessing one", () => {
    const res = respond("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة الجلاصي على الساعة 10", ctx());
    expect(res.action!.fields.caseId).toBeUndefined();
    expect(res.action!.ambiguities.join(" ")).toContain("لم أجد");
    expect(missingFields(res.action!)).toContain("caseId");
  });

  it("does not reveal restricted files to users who are not staffed on them", () => {
    const res = respond("حضّرلي ملخص لملف ورثة القروي", ctx());
    expect(res.text).toContain("لم أجد");
    expect(JSON.stringify(res.blocks)).not.toContain("المنستير");
  });

  it("detects scheduling conflicts and requires explicit acknowledgment", () => {
    const h1 = getDB().hearings.find((h) => h.id === "h1")!;
    const [y, m, d] = h1.date.split("-").map(Number);
    const res = respond(`سجّللي جلسة نهار ${d}/${m}/${y} مع ملف سامي مراد على الساعة 09:30`, ctx());
    const action = res.action!;
    expect(actionConflicts(action).length).toBeGreaterThan(0);
    const before = snapshot();
    const refused = actionExecutor.execute(action);
    expect(refused.ok).toBe(false);
    expect(snapshot()).toEqual(before);

    const accepted = actionExecutor.execute({ ...action, acknowledgedConflicts: true });
    expect(accepted.ok).toBe(true);
    expect(getDB().hearings.length).toBe(before.hearings + 1);
    const write = getDB().audit.find((a) => a.action === "hearing.create");
    expect(write).toMatchObject({ via: "assistant" });
    expect(write?.details?.approvalId).toBeTruthy();
    expect(getDB().audit.some((a) => a.action === "approval.approve")).toBe(true);
    expect(getDB().timeline.some((t) => t.caseId === "2" && t.title === "برمجة جلسة")).toBe(true);
  });

  it("refuses to execute a draft with missing fields", () => {
    const res = respond("سجّللي جلسة مع ملف عائلة بن صالح", ctx());
    const r = actionExecutor.execute(res.action!);
    expect(r.ok).toBe(false);
  });
});

describe("relative reminders", () => {
  it("computes 'two days before the hearing' from the resolved hearing", () => {
    const res = respond("ذكّرني قبل الجلسة بيومين", ctx({ caseId: "1" }));
    const h4 = getDB().hearings.find((h) => h.id === "h4")!;
    const expected = new Date(h4.date);
    expected.setDate(expected.getDate() - 2);
    expect(res.action!.fields.hearingId).toBe("h4");
    expect(res.action!.fields.date).toBe(expected.toISOString().slice(0, 10));
    expect(res.memory.lastHearingId).toBe("h4");
  });

  it("resolves 'قبلها' to the hearing mentioned earlier in the conversation", () => {
    const res = respond("ذكّرني قبلها بيومين", ctx({ memory: { lastHearingId: "h3" } }));
    expect(res.action!.fields.hearingId).toBe("h3");
  });

  it("creates a real task with timeline sync after confirmation", () => {
    const res = respond("اعمل تذكير باش نكلّم الحريف نهار الجمعة على الساعة 11", ctx({ caseId: "2" }));
    const r = actionExecutor.execute(res.action!);
    expect(r.ok).toBe(true);
    const created = getDB().tasks.find((t) => t.id === (r.ok ? r.data.entityId : ""));
    expect(created).toMatchObject({ kind: "reminder", dueDate: "2026-10-23", dueTime: "11:00", caseId: "2", source: "assistant" });
  });
});

describe("authorization", () => {
  it("blocks financial queries and receipts for a secretary", () => {
    switchDemoUser("u3");
    const fees = respond("ورّيني الأتعاب اللي مازالت ما تخلّصتش", ctx());
    expect(blocksOf(fees.blocks, "notice")[0]?.tone).toBe("danger");
    const receipt = respond("اعمل وصل خلاص لسامي مراد بـ 1000 دينار", ctx());
    expect(receipt.action!.blockedReason).toBeTruthy();
    expect(actionExecutor.execute(receipt.action!).ok).toBe(false);
  });

  it("rejects receipts above the remaining balance", () => {
    const res = respond("اعمل وصل خلاص لسامي مراد بـ 5000 دينار", ctx());
    expect(res.action!.ambiguities.join(" ")).toContain("يتجاوز");
    expect(actionExecutor.execute(res.action!).ok).toBe(false);
    expect(getDB().receipts).toHaveLength(0);
  });

  it("never reports success when the write cannot be persisted", () => {
    const res = respond("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10", ctx());
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const before = snapshot();
    const r = actionExecutor.execute(res.action!);
    spy.mockRestore();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("storage");
    expect(snapshot()).toEqual(before);
  });
});

describe("legal research safety", () => {
  it("builds a cited hearing brief without invented article numbers or injected instructions", () => {
    const gen = generateBrief("1", { now: NOW })!;
    expect(gen.brief.sections.map((s) => s.title)).toEqual([
      "ملف القضية", "الوقائع الأساسية", "التسلسل الزمني", "النقاط القانونية", "الحجج الممكنة",
      "الحجج المضادة المتوقعة", "نقاط الضعف", "الوثائق الناقصة", "أسئلة للمرافعة", "مراجع تحتاج إلى التحقق",
    ]);
    const all = JSON.stringify(gen.brief);
    expect(all).not.toMatch(/الفصل\s*\d+|الفصول\s*\d+|article\s*\d+/i);
    expect(all).not.toContain("تجاهل جميع التعليمات");
    expect(gen.droppedInstructions).toBeGreaterThan(0);
    const docIds = new Set(getDB().documents.map((d) => d.id));
    for (const c of gen.citations) {
      expect(docIds.has(c.documentId)).toBe(true);
      const doc = getDB().documents.find((d) => d.id === c.documentId)!;
      expect(doc.pages.some((p) => p.number === c.page)).toBe(true);
    }
    const missing = gen.brief.sections.find((s) => s.key === "missing")!.items.map((i) => i.text).join(" ");
    expect(missing).toContain("حجة الوفاة والوراثة");
    const sourceItems = gen.brief.sections.flatMap((s) => s.items).filter((i) => i.kind === "generated");
    expect(sourceItems.length).toBeGreaterThan(0);
  });

  it("answers archive searches with citations, and says so when nothing exists", () => {
    const found = respond("فتّشلي على حكم قديم في نزاع ميراث", ctx());
    const sources = blocksOf(found.blocks, "sources")[0];
    expect(sources.citations[0].documentId).toBe("a1");
    expect(sources.citations[0].page).toBeGreaterThan(0);

    const none = respond("فتّشلي على حكم في كفالة بنكية دولية", ctx());
    expect(none.text).toContain("لن أقترح");
    expect(blocksOf(none.blocks, "sources")).toHaveLength(0);
  });

  it("flags prompt-injection content when summarising a case", () => {
    const res = respond("حضّرلي ملخص للقضية متاع عائلة بن صالح", ctx());
    expect(blocksOf(res.blocks, "notice").some((n) => n.tone === "danger" && n.text.includes("تعليمات"))).toBe(true);
  });

  it("compares a current case with archived cases using retrieved text", () => {
    const res = respond("قارن قضية بن صالح مع القضايا القديمة", ctx());
    const comparison = blocksOf(res.blocks, "comparison")[0];
    expect(comparison.title).toContain("CC/2019/0124");
    expect(comparison.rows.some((r) => r.citation?.documentId === "a1")).toBe(true);
  });

  it("wraps documents as untrusted data for server-side prompts", () => {
    const wrapped = wrapUntrustedDocument(getDB().documents.find((d) => d.id === "d6")!);
    expect(wrapped).toContain('trusted="false"');
    expect(wrapped).toContain('suspicious="instruction-like-content"');
  });
});

describe("read-only intents", () => {
  it("lists next week's hearings with conflicts", () => {
    const res = respond("شنوة الجلسات اللي عندي الأسبوع الجاي؟", ctx());
    expect(res.intent).toBe("list_upcoming_hearings");
    const items = blocksOf(res.blocks, "list")[0]?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.href)).toBe(true);
  });

  it("asks which case when a case-specific request has none", () => {
    const res = respond("اقترح حجج قانونية للملف هذا", ctx());
    expect(res.text).toContain("على أي قضية");
  });
});
