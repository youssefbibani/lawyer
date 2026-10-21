import { describe, it, expect, beforeEach } from "vitest";

import { commit, getDB, resetDB } from "@/services/db";
import { createHearing, switchDemoUser, updateHearing, runUnderApproval, updatePolicy } from "@/services/api";
import { approveAndExecute, decideOperation, executeOperation, proposeOperation } from "@/services/approvals";
import { verifyAuditChain } from "@/services/audit";
import { MemoryBlobStore, setBlobStore } from "@/services/archive/blobStore";
import { drainJobs, importFiles, reattachFile, resumeProcessing, retryItem, setPipelineDeps } from "@/services/archive/pipeline";
import { applyVerification, createBatch, createItem, finalizeItems, findItem, mutateItem, returnForCorrection, resubmitItem, saveReview, setCaseDecision } from "@/services/archive/service";
import { requestFinalization, submitVerification } from "@/services/archive/actions";
import { canTransition } from "@/services/archive/workflow";
import { searchDocuments } from "@/services/retrieval";
import type { OcrProvider } from "@/services/archive/ocr";
import type { ArchiveItem } from "@/types";

// ——— Fixtures: synthetic pages + deterministic OCR ———

const FIXTURES: Record<string, { text: string; confidence: number; low?: string[] }[]> = {
  "hokm-2019.pdf": [
    {
      text: "الجمهورية التونسية — محكمة التعقيب — القضية عدد CC/2019/0124\nحكم في حق ورثة عائلة بن صالح بتاريخ 12 جوان 2019\nوحيث أن النزاع يتعلق بقسمة التركة والميراث بصفاقس\nصفحة 1 من 3",
      confidence: 91,
    },
    { text: "لهذه الأسباب حكمت المحكمة بتأييد الحكم الابتدائي في قسمة التركة بين الورثة.\nصفحة 2 من 3", confidence: 88 },
  ],
  "requete-fr.jpg": [
    {
      text: "Requête adressée à la Cour d'appel de Tunis le 3 mars 2020 au nom de M. Sami Mourad concernant la liquidation du compte commun et la demande de dommages.",
      confidence: 72,
      low: ["Mourad"],
    },
  ],
  "lettre-mixte.png": [
    { text: "إلى السيد سامي مراد المحترم، تحية طيبة\nObjet : règlement des honoraires — montant restant 3000 dinars\nمع خالص التقدير", confidence: 80 },
  ],
  "flou.jpg": [{ text: "نص غير واضح", confidence: 30, low: ["نص", "واضح"] }],
};

let ocrCalls = 0;
let ocrBroken = false;
const fixtureOcr: OcrProvider = {
  id: "fixture",
  label: "fixture",
  local: true,
  async recognize(image) {
    ocrCalls++;
    if (ocrBroken) throw new Error("NetworkError when attempting to fetch resource.");
    const { file, page } = JSON.parse(await image.text()) as { file: string; page: number };
    const fx = FIXTURES[file]?.[page];
    if (!fx) throw new Error("unreadable");
    return { text: fx.text, confidence: fx.confidence, words: (fx.low ?? []).map((w) => ({ text: w, confidence: 40 })) };
  },
};

function file(name: string, type: string, body = name) {
  return new File([body], name, { type });
}

let store: MemoryBlobStore;

beforeEach(() => {
  resetDB(new Date(2026, 9, 18, 10));
  store = new MemoryBlobStore();
  setBlobStore(store);
  ocrCalls = 0;
  ocrBroken = false;
  setPipelineDeps({
    store: () => store,
    ocr: () => fixtureOcr,
    hash: async (b) => `h-${await b.text()}`,
    renderForOcr: async (b) => b,
    rasterize: async (blob, _mime, onPage) => {
      const name = (blob as File).name ?? JSON.parse(await blob.text()).file;
      const pages = FIXTURES[name]?.length ?? 1;
      onPage?.(pages, pages);
      return Array.from({ length: pages }, (_, n) => ({
        blob: new Blob([JSON.stringify({ file: name, page: n })]),
        thumb: new Blob(["thumb"]),
        width: 1000,
        height: 1400,
        quality: { analyzed: true, blurry: name.startsWith("flou"), blank: false },
      }));
    },
  });
});

function newBatch() {
  const r = createBatch({ name: "دفعة اختبار", reference: `ARC-T-${Math.random().toString(36).slice(2, 6)}`, location: "العلبة 1", responsibleId: "u3" });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** For image fixtures the original file *is* the page raster, so OCR receives the File: wrap it. */
async function importAndProcess(batchId: string, files: File[]) {
  const result = await importFiles(batchId, files);
  await drainJobs();
  return result;
}

function item(id: string): ArchiveItem {
  return findItem(id)!;
}

// Image originals are passed to OCR as-is; make fixture images carry the JSON page marker.
const img = (name: string, type: string) => file(name, type, JSON.stringify({ file: name, page: 0 }));

describe("archive workflow — upload, OCR and extraction", () => {
  it("processes a single PDF through upload → OCR → review with extracted metadata", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf")]);
    const it1 = item(items[0].id);
    expect(it1.state).toBe("review");
    expect(it1.history.map((h) => h.to).filter(Boolean)).toEqual(["draft", "uploading", "ocr", "review"]);
    expect(await store.has(`orig:${it1.id}`)).toBe(true);
    expect(it1.pages).toHaveLength(2);
    const field = (k: string) => it1.fields.find((f) => f.key === k)?.value;
    expect(field("caseRef")).toBe("CC/2019/0124");
    expect(field("date")).toBe("2019-06-12");
    expect(field("court")).toContain("محكمة التعقيب");
    expect(field("client")).toBe("عائلة بن صالح");
    expect(it1.classification?.suggested).toBe("judgment");
    expect(it1.classification?.evidence.join(" ")).toContain("لهذه الأسباب");
    expect(it1.missingPages).toEqual([3]);
    expect(it1.pages[0].ocr?.lang).toBe("ar");
  });

  it("handles a batch with Arabic, French and mixed documents and rejects invalid files", async () => {
    const batch = newBatch();
    const { items, rejected } = await importAndProcess(batch.id, [
      file("hokm-2019.pdf", "application/pdf"),
      img("requete-fr.jpg", "image/jpeg"),
      img("lettre-mixte.png", "image/png"),
      file("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      file("photo.heic", "image/heic"),
    ]);
    expect(items).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(rejected.join(" ")).toContain("HEIC");
    const langs = items.map((i) => item(i.id).pages[0].ocr?.lang);
    expect(langs).toEqual(["ar", "fr", "mixed"]);
    const fr = item(items[1].id);
    expect(fr.fields.find((f) => f.key === "court")?.value).toMatch(/Cour d'appel de Tunis/);
    expect(fr.fields.find((f) => f.key === "date")?.value).toBe("2020-03-03");
    expect(fr.classification?.suggested).toBe("petition");
    expect(fr.pages[0].ocr?.uncertain).toContain("Mourad");
    expect(item(items[2].id).classification?.suggested).toBe("correspondence");
  });

  it("flags blurry pages and low-confidence fields instead of hiding them", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [img("flou.jpg", "image/jpeg")]);
    const i = item(items[0].id);
    expect(i.pages[0].quality.blurry).toBe(true);
    expect(i.pages[0].ocr?.confidence).toBe(30);
    expect(i.classification?.suggested).toBe("other");
  });

  it("never fabricates OCR: no engine → failed state and no extracted fields", async () => {
    setPipelineDeps({ store: () => store, ocr: () => null, hash: async (b) => `h-${await b.text()}`, renderForOcr: async (b) => b, rasterize: async () => [{ blob: new Blob(["x"]), thumb: new Blob(["t"]), width: 1, height: 1, quality: { analyzed: false } }] });
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf")]);
    const i = item(items[0].id);
    expect(i.state).toBe("failed");
    expect(i.error).toContain("لا يوجد محرك OCR");
    expect(i.fields).toHaveLength(0);
  });

  it("retries a failed extraction without re-uploading and without duplicating originals", async () => {
    ocrBroken = true;
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf")]);
    expect(item(items[0].id).state).toBe("failed");
    expect(item(items[0].id).error).toContain("اتصال الشبكة");
    ocrBroken = false;
    const r = await retryItem(items[0].id);
    expect(r.ok).toBe(true);
    await drainJobs();
    expect(item(items[0].id).state).toBe("review");
  });
});

describe("duplicates, classification and human review", () => {
  it("detects exact duplicates with evidence and never deletes either copy", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf"), file("hokm-2019.pdf", "application/pdf")]);
    const second = item(items[1].id);
    const dup = second.duplicates.find((d) => d.targetId === items[0].id)!;
    expect(dup.kind).toBe("exact");
    expect(dup.evidence.join(" ")).toContain("SHA-256");
    expect(getDB().archiveItems.filter((i) => i.batchId === batch.id)).toHaveLength(2);
  });

  it("lets a reviewer override a wrong classification and correct OCR text separately from the original", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [img("lettre-mixte.png", "image/png")]);
    const before = item(items[0].id);
    const page = before.pages[0];
    const r = saveReview(before.id, before.version, {
      category: "financial",
      corrected: { [page.id]: `${page.ocr!.text}\nملاحظة مصححة` },
      fields: before.fields.map((f) => (f.key === "client" ? { ...f, value: "سامي مراد" } : f)),
    });
    expect(r.ok).toBe(true);
    const after = item(before.id);
    expect(after.classification?.final).toBe("financial");
    expect(after.classification?.overriddenBy).toBe("u1");
    expect(after.pages[0].ocr?.text).toBe(page.ocr!.text);
    expect(after.pages[0].correctedText).toContain("ملاحظة مصححة");
    expect(after.history.at(-1)?.changes?.some((c) => c.label === "التصنيف")).toBe(true);
  });

  it("rejects concurrent edits from another user (optimistic concurrency)", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [img("lettre-mixte.png", "image/png")]);
    const base = item(items[0].id);
    expect(saveReview(base.id, base.version, { category: "correspondence" }).ok).toBe(true);
    switchDemoUser("u3");
    const stale = saveReview(base.id, base.version, { category: "contract" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("conflict");
  });

  it("supports return for correction and resubmission with validated transitions", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [img("requete-fr.jpg", "image/jpeg")]);
    let i = item(items[0].id);
    expect(returnForCorrection(i.id, i.version, "").ok).toBe(false);
    expect(returnForCorrection(i.id, i.version, "التاريخ غير مقروء").ok).toBe(true);
    i = item(i.id);
    expect(i.state).toBe("needs_correction");
    expect(resubmitItem(i.id, i.version).ok).toBe(true);
    expect(item(i.id).state).toBe("review");
    expect(canTransition("review", "archived")).toBe(false);
    expect(mutateItem(i.id, { action: "تجاوز", to: "archived" }).ok).toBe(false);
  });

  it("only suggests cases — uncertain matches are labelled and never auto-assigned", async () => {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [img("requete-fr.jpg", "image/jpeg"), file("hokm-2019.pdf", "application/pdf")]);
    const fr = item(items[0].id);
    expect(fr.caseMatch.caseId).toBeUndefined();
    const hokm = item(items[1].id);
    expect(hokm.caseMatch.suggestions[0].caseId).toBe("1");
    expect(hokm.caseMatch.suggestions[0].evidence.join(" ")).toContain("بن صالح");
    expect(hokm.caseMatch.caseId).toBeUndefined();
    expect(hokm.caseMatch.decision).toBe("pending");
  });
});

describe("approval engine & archiving", () => {
  async function readyItem(name = "hokm-2019.pdf", type = "application/pdf") {
    const batch = newBatch();
    const { items } = await importAndProcess(batch.id, [type.startsWith("image") ? img(name, type) : file(name, type)]);
    let i = item(items[0].id);
    expect(setCaseDecision(i.id, i.version, "approved", "1").ok).toBe(true);
    i = item(i.id);
    const sub = submitVerification(i.id, { uncertaintyReviewed: true });
    if (!sub.ok) throw new Error(sub.error);
    return { batch, itemId: i.id, request: sub.data };
  }

  it("a clerk can prepare proposals but cannot approve them; a lawyer can", async () => {
    switchDemoUser("u3");
    const { itemId, request } = await readyItem();
    expect(item(itemId).state).toBe("pending_approval");
    const denied = decideOperation(request.id, "approve");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("forbidden");
    expect(executeOperation(request.id).ok).toBe(false);
    switchDemoUser("u1");
    expect(approveAndExecute(request.id).ok).toBe(true);
    expect(item(itemId).state).toBe("ready");
  });

  it("rejection returns the document for review; resubmission creates a new request", async () => {
    const { itemId, request } = await readyItem();
    expect(decideOperation(request.id, "reject", "الطرف غير صحيح").ok).toBe(true);
    expect(item(itemId).state).toBe("review");
    const again = submitVerification(itemId, { uncertaintyReviewed: true });
    expect(again.ok).toBe(true);
    expect(again.ok && again.data.id).not.toBe(request.id);
  });

  it("blocks every approval bypass through direct API calls", async () => {
    const { itemId, request } = await readyItem();
    expect(applyVerification(request.params as never).ok).toBe(false);
    expect(finalizeItems({ batchId: "x", items: [{ itemId, version: 1 }] }).ok).toBe(false);
    const hearing = createHearing({ caseId: "1", court: "ق", room: "1", type: "جلسة", date: "2026-11-11", time: "10:00" }, "assistant");
    expect(hearing.ok).toBe(false);
    expect(() => runUnderApproval(request.id, () => 1)).toThrow();
    // Tampering with stored parameters after approval is detected.
    approveAndExecute(request.id);
    const tampered = proposeOperation("hearing.create", { caseId: "1", court: "ق", room: "1", type: "جلسة", date: "2026-11-11", time: "10:00" }, { via: "assistant" });
    expect(tampered.ok).toBe(true);
    if (tampered.ok) {
      decideOperation(tampered.data.id, "approve");
      commit((d) => ({ ...d, approvals: d.approvals.map((a) => (a.id === tampered.data.id ? { ...a, params: { ...a.params, date: "2026-12-25" } } : a)) }));
      const ex = executeOperation(tampered.data.id);
      expect(ex.ok).toBe(false);
      expect(getDB().hearings.some((h) => h.date === "2026-12-25")).toBe(false);
    }
  });

  it("rejects stale approvals when the underlying record changed", () => {
    const h3 = getDB().hearings.find((h) => h.id === "h3")!;
    const r = proposeOperation("hearing.update", { hearingId: "h3", date: h3.date, time: "15:00" }, { via: "assistant" });
    expect(r.ok).toBe(true);
    // Another user moves the same hearing in the meantime.
    expect(updateHearing("h3", { time: "12:00" }).ok).toBe(true);
    const decided = decideOperation(r.ok ? r.data.id : "", "approve");
    expect(decided.ok).toBe(false);
    expect(getDB().approvals.find((a) => a.id === (r.ok ? r.data.id : ""))?.status).toBe("stale");
    expect(getDB().hearings.find((h) => h.id === "h3")?.time).toBe("12:00");
  });

  it("finalizes atomically, is idempotent, and indexes the verified documents", async () => {
    const { batch: b, itemId, request } = await readyItem();
    approveAndExecute(request.id);
    const docsBefore = getDB().documents.length;
    const fin = requestFinalization(item(itemId).batchId, [itemId]);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    const done = approveAndExecute(fin.data.id);
    expect(done.ok).toBe(true);
    expect(getDB().documents.length).toBe(docsBefore + 1);
    const archived = item(itemId);
    expect(archived.state).toBe("archived");
    const doc = getDB().documents.find((d) => d.id === archived.archivedDocumentId)!;
    expect(doc.verified?.approvedBy).toBe("u1");
    expect(doc.caseId).toBe("1");
    expect(await store.has(`orig:${itemId}`)).toBe(true);
    // Repeated execution is refused, nothing is duplicated.
    const again = executeOperation(fin.data.id);
    expect(again.ok).toBe(false);
    expect(getDB().documents.length).toBe(docsBefore + 1);
    // A second finalization request for the same document cannot be created.
    expect(requestFinalization(b.id, [itemId]).ok).toBe(false);
    // Archived documents are searchable and immutable.
    expect(searchDocuments("التركة", { scope: "archive" }).hits.some((h) => h.document.id === doc.id)).toBe(true);
    expect(saveReview(itemId, archived.version, { category: "other" }).ok).toBe(false);
  });

  it("marks a finalization approval stale if a document changed after the request", async () => {
    const { itemId, request } = await readyItem();
    approveAndExecute(request.id);
    const fin = requestFinalization(item(itemId).batchId, [itemId]);
    if (!fin.ok) throw new Error(fin.error);
    const current = item(itemId);
    saveReview(itemId, current.version, { category: "minutes" });
    const r = approveAndExecute(fin.data.id);
    expect(r.ok).toBe(false);
    expect(item(itemId).state).not.toBe("archived");
  });

  it("lets the office relax the clerk rule only for eligible operations", () => {
    updatePolicy({ clerkRequiresLawyerApproval: false });
    switchDemoUser("u3");
    const h = proposeOperation("hearing.create", { caseId: "1", court: "ق", room: "1", type: "جلسة", date: "2026-11-11", time: "10:00" }, { via: "assistant" });
    expect(h.ok && h.data.approverRoles).toContain("secretary");
    const fin = proposeOperation("archive.finalize", { batchId: "b-seed-1", items: [] }, { via: "manual" });
    expect(fin.ok).toBe(false);
  });
});

describe("interruption, resume and audit integrity", () => {
  it("flags an upload interrupted before the original was saved, then resumes after re-attaching the same file", async () => {
    const batch = newBatch();
    const created = createItem(batch.id, { name: "hokm-2019.pdf", type: "application/pdf", size: "hokm-2019.pdf".length });
    if (!created.ok) throw new Error(created.error);
    mutateItem(created.data.id, { action: "بدء الرفع", to: "uploading", system: true });
    resumeProcessing();
    expect(item(created.data.id).state).toBe("failed");
    expect(item(created.data.id).error).toContain("أعد اختيار نفس الملف");
    const wrong = await reattachFile(created.data.id, file("other.pdf", "application/pdf", "different content!!"));
    expect(wrong.ok).toBe(false);
    const ok = await reattachFile(created.data.id, file("hokm-2019.pdf", "application/pdf"));
    expect(ok.ok).toBe(true);
    await drainJobs();
    expect(item(created.data.id).state).toBe("review");
  });

  it("re-queues jobs abandoned by a closed tab and does not repeat finished OCR pages", async () => {
    const batch = newBatch();
    await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf")]);
    const calls = ocrCalls;
    const it1 = getDB().archiveItems.find((i) => i.batchId === batch.id)!;
    // Simulate: item back in OCR with one page already recognised and a stale "running" job of another tab.
    commit((d) => ({
      ...d,
      archiveItems: d.archiveItems.map((i) => (i.id === it1.id ? { ...i, state: "ocr" as const, pages: i.pages.map((p, n) => (n === 1 ? { ...p, ocr: undefined } : p)) } : i)),
      jobs: [...d.jobs, { id: "job-stale", itemId: it1.id, stage: "ocr" as const, status: "running" as const, attempts: 1, owner: "tab-closed", heartbeat: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date().toISOString() }],
    }));
    resumeProcessing();
    await drainJobs();
    expect(item(it1.id).state).toBe("review");
    expect(ocrCalls - calls).toBe(1);
  });

  it("keeps a verifiable, tamper-evident audit chain", async () => {
    const batch = newBatch();
    await importAndProcess(batch.id, [file("hokm-2019.pdf", "application/pdf")]);
    expect(verifyAuditChain(getDB().audit).ok).toBe(true);
    const tampered = getDB().audit.map((a, i) => (i === 2 ? { ...a, summary: "تعديل خفي" } : a));
    expect(verifyAuditChain(tampered).ok).toBe(false);
    const removed = getDB().audit.filter((_, i) => i !== 1);
    expect(verifyAuditChain(removed).ok).toBe(false);
  });
});
