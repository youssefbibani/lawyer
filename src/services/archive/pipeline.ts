/**
 * Archive processing pipeline: import → prepare (rasterise, thumbnails, quality) → OCR → analysis.
 *
 * - Jobs are persisted (db.jobs) and processed one at a time by a single runner per tab.
 *   A job is claimed with an owner id + heartbeat, so two tabs/users never process the same job.
 * - Resumable: OCR is saved page by page; interrupted jobs are re-queued on start; deterministic
 *   blob keys + write-once storage make retries idempotent.
 * - Never fabricates results: a missing OCR engine or any failure moves the item to "فشلت المعالجة".
 */
import { useSyncExternalStore } from "react";

import type { ArchiveItem, ArchivePage, ProcessingJob } from "@/types";
import { commit, getDB, newId } from "@/services/db";
import type { ApiResult } from "@/services/api";
import { getBlobStore, ImmutableBlobError, type BlobStore } from "@/services/archive/blobStore";
import { getOcrProvider, toPageOcr, type OcrProvider } from "@/services/archive/ocr";
import { classify, extractFields, findDuplicates, matchCases } from "@/services/archive/analysis";
import { detectMissingPages } from "@/services/archive/quality";
import { accessibleCasesForMatching, createItem, findItem, mutateItem } from "@/services/archive/service";
import { validateFile } from "@/services/archive/workflow";
import type { RasterPage } from "@/services/archive/imaging";
import { sha256Bytes } from "@/lib/hash";

export interface PipelineDeps {
  store: () => BlobStore;
  ocr: () => OcrProvider | null;
  rasterize: (blob: Blob, mime: string, onPage?: (done: number, total: number) => void) => Promise<RasterPage[]>;
  renderForOcr: (blob: Blob, rotation: number) => Promise<Blob>;
  hash: (blob: Blob) => Promise<string>;
}

const defaultDeps: PipelineDeps = {
  store: getBlobStore,
  ocr: getOcrProvider,
  rasterize: async (blob, mime, onPage) => (await import("@/services/archive/imaging")).rasterize(blob, mime, onPage),
  renderForOcr: async (blob, rotation) => (await import("@/services/archive/imaging")).renderForOcr(blob, rotation),
  hash: sha256Bytes,
};

let deps: PipelineDeps = defaultDeps;
export function setPipelineDeps(patch: Partial<PipelineDeps>) {
  deps = { ...defaultDeps, ...patch };
}

const TAB_ID = newId("tab");
const HEARTBEAT_MS = 5_000;
const STALE_MS = 20_000;

// ——— Live progress (in memory, not persisted on every tick) ———

type Progress = { stage: string; fraction: number };
const progress = new Map<string, Progress>();
const progressListeners = new Set<() => void>();
let progressSnapshot = new Map(progress);
function setProgress(itemId: string, value: Progress | null) {
  if (value) progress.set(itemId, value);
  else progress.delete(itemId);
  progressSnapshot = new Map(progress);
  progressListeners.forEach((l) => l());
}
export function useItemProgress(): Map<string, Progress> {
  return useSyncExternalStore(
    (l) => {
      progressListeners.add(l);
      return () => progressListeners.delete(l);
    },
    () => progressSnapshot,
    () => progressSnapshot,
  );
}

/** Files selected in this session (kept so failed imports can be retried without re-selecting). */
const sessionFiles = new Map<string, File[]>();

// ——— Jobs ———

function enqueue(itemId: string, stage: ProcessingJob["stage"]) {
  const now = new Date().toISOString();
  commit((d) => {
    const existing = d.jobs.find((j) => j.itemId === itemId && j.stage === stage && (j.status === "queued" || j.status === "running"));
    if (existing) return d; // idempotent
    return { ...d, jobs: [...d.jobs.filter((j) => !(j.itemId === itemId && j.stage === stage)), { id: newId("job"), itemId, stage, status: "queued", attempts: 0, updatedAt: now }] };
  });
  void runJobs();
}

function updateJob(id: string, patch: Partial<ProcessingJob>) {
  commit((d) => ({ ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: new Date().toISOString() } : j)) }));
}

function claimNext(): ProcessingJob | undefined {
  const now = Date.now();
  let claimed: ProcessingJob | undefined;
  commit((d) => {
    const job = d.jobs.find(
      (j) => j.status === "queued" || (j.status === "running" && j.owner !== TAB_ID && now - new Date(j.heartbeat ?? 0).getTime() > STALE_MS),
    );
    if (!job) return d;
    claimed = { ...job, status: "running", owner: TAB_ID, heartbeat: new Date().toISOString(), attempts: job.attempts + 1 };
    return { ...d, jobs: d.jobs.map((j) => (j.id === job.id ? claimed! : j)) };
  });
  return claimed;
}

let running: Promise<void> | null = null;

/** Processes queued jobs sequentially. Safe to call repeatedly (single-flight per tab). */
export function runJobs(): Promise<void> {
  running ??= (async () => {
    // Yield first: if the queue is empty the body would otherwise finish (and reset `running`)
    // before the assignment above, leaving the runner permanently marked as busy.
    await Promise.resolve();
    try {
      for (;;) {
        const job = claimNext();
        if (!job) break;
        const beat = setInterval(() => updateJob(job.id, { heartbeat: new Date().toISOString() }), HEARTBEAT_MS);
        try {
          if (job.stage === "prepare") await prepare(job.itemId);
          else await ocr(job.itemId);
          updateJob(job.id, { status: "done", error: undefined });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateJob(job.id, { status: "failed", error: message });
          failItem(job.itemId, message);
        } finally {
          clearInterval(beat);
          setProgress(job.itemId, null);
        }
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

function failItem(itemId: string, message: string) {
  const item = findItem(itemId);
  if (!item || item.state === "failed" || item.state === "archived") return;
  mutateItem(itemId, { action: "فشل المعالجة", to: "failed", note: message, system: true }, (i) => ({ ...i, error: humanError(message) }));
}

function humanError(message: string): string {
  if (message.startsWith("no-ocr")) return "لا يوجد محرك OCR مهيأ في هذا المتصفح. لم يُستخرج أي نص.";
  if (message.includes("original-missing")) return "الملف الأصلي غير موجود في التخزين: أعد اختيار الملف.";
  if (/fetch|network|Failed to fetch|NetworkError/i.test(message)) return "تعذّر تحميل محرك OCR أو نماذج اللغة (اتصال الشبكة). أعد المحاولة.";
  if (/password|PasswordException/i.test(message)) return "ملف PDF محمي بكلمة مرور.";
  if (/Invalid PDF|InvalidPDFException/i.test(message)) return "ملف PDF تالف أو غير صالح.";
  return `فشلت المعالجة: ${message.slice(0, 160)}`;
}

// ——— Import ———

export interface ImportResult {
  items: ArchiveItem[];
  rejected: string[];
}

/** Stores originals (immutable) and queues processing. `asSingleDocument` merges images as pages. */
export async function importFiles(batchId: string, files: File[], options: { asSingleDocument?: boolean } = {}): Promise<ImportResult> {
  const rejected: string[] = [];
  const valid = files.filter((f) => {
    const err = validateFile(f);
    if (err) rejected.push(err);
    return !err;
  });
  if (options.asSingleDocument && valid.some((f) => f.type === "application/pdf")) {
    return { items: [], rejected: [...rejected, "دمج الصفحات متاح للصور فقط."] };
  }
  const groups = options.asSingleDocument && valid.length ? [valid] : valid.map((f) => [f]);
  const items: ArchiveItem[] = [];
  for (const group of groups) {
    const first = group[0];
    const name = group.length > 1 ? `وثيقة ملتقطة (${group.length} صفحات) — ${new Date().toLocaleTimeString("en-GB")}` : first.name;
    const created = createItem(batchId, { name, type: first.type, size: group.reduce((s, f) => s + f.size, 0) });
    if (!created.ok) {
      rejected.push(created.error);
      continue;
    }
    sessionFiles.set(created.data.id, group);
    const started = await storeOriginals(created.data.id, group);
    if (started.ok) items.push(started.data);
    else rejected.push(`«${name}»: ${started.error}`);
  }
  return { items, rejected };
}

async function storeOriginals(itemId: string, files: File[]): Promise<ApiResult<ArchiveItem>> {
  const item = findItem(itemId);
  if (!item) return { ok: false, code: "not_found", error: "الوثيقة غير موجودة." };
  if (item.state !== "uploading") {
    const r = mutateItem(itemId, { action: "بدء الرفع", to: "uploading", system: true });
    if (!r.ok) return r;
  }
  try {
    setProgress(itemId, { stage: "حساب البصمة الرقمية", fraction: 0.1 });
    const digest = files.length === 1 ? await deps.hash(files[0]) : await deps.hash(new Blob(files));
    setProgress(itemId, { stage: "حفظ الأصل", fraction: 0.4 });
    const keys: string[] = [];
    for (let n = 0; n < files.length; n++) {
      const key = files.length === 1 ? `orig:${itemId}` : `orig:${itemId}:${n}`;
      await putOnce(key, files[n]);
      keys.push(key);
    }
    const r = mutateItem(itemId, { action: "حفظ الأصل", system: true }, (i) => ({
      ...i,
      sha256: digest,
      originalFileKey: keys[0],
      pages: files.length > 1 ? keys.map((k, n) => blankPage(itemId, n, k)) : i.pages,
      error: undefined,
    }));
    if (!r.ok) return r;
    setProgress(itemId, { stage: "في قائمة المعالجة", fraction: 0.5 });
    enqueue(itemId, "prepare");
    return r;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failItem(itemId, message);
    setProgress(itemId, null);
    return { ok: false, code: "storage", error: humanError(message) };
  }
}

async function putOnce(key: string, blob: Blob) {
  const store = deps.store();
  try {
    await store.put(key, blob);
  } catch (err) {
    if (!(err instanceof ImmutableBlobError)) throw err;
    // Already stored by a previous (interrupted) attempt — originals are immutable, keep the first one.
  }
}

function blankPage(itemId: string, index: number, originalKey: string): ArchivePage {
  return { id: `${itemId}-p${index}`, index, originalKey, rotation: 0, quality: { analyzed: false } };
}

// ——— Stages ———

async function prepare(itemId: string) {
  const item = findItem(itemId);
  if (!item || item.state !== "uploading") return;
  if (!item.originalFileKey) throw new Error("original-missing");
  const store = deps.store();
  let pages: ArchivePage[];
  if (item.pages.length > 1) {
    // Multi-photo capture: each original image is a page.
    pages = [];
    for (const p of item.pages) {
      const blob = await store.get(p.originalKey);
      if (!blob) throw new Error("original-missing");
      const [raster] = await deps.rasterize(blob, blob.type || item.mimeType);
      await putOnce(`thumb:${p.id}`, raster.thumb);
      pages.push({ ...p, thumbKey: `thumb:${p.id}`, width: raster.width, height: raster.height, quality: raster.quality });
      setProgress(itemId, { stage: "تجهيز الصفحات", fraction: 0.5 + 0.5 * (pages.length / item.pages.length) });
    }
  } else {
    const original = await store.get(item.originalFileKey);
    if (!original) throw new Error("original-missing");
    const rasters = await deps.rasterize(original, item.mimeType, (done, total) =>
      setProgress(itemId, { stage: `تجهيز الصفحة ${done} من ${total}`, fraction: 0.5 + 0.5 * (done / total) }),
    );
    pages = [];
    for (let n = 0; n < rasters.length; n++) {
      const id = `${itemId}-p${n}`;
      const isImage = item.mimeType !== "application/pdf";
      const key = isImage ? item.originalFileKey : `page:${id}`;
      if (!isImage) await putOnce(key, rasters[n].blob);
      await putOnce(`thumb:${id}`, rasters[n].thumb);
      pages.push({ id, index: n, originalKey: key, thumbKey: `thumb:${id}`, rotation: 0, width: rasters[n].width, height: rasters[n].height, quality: rasters[n].quality });
    }
  }
  if (!pages.length) throw new Error("لم يتم العثور على أي صفحة في الملف.");
  const r = mutateItem(itemId, { action: "تجهيز الصفحات", to: "ocr", system: true }, (i) => ({ ...i, pages }));
  if (!r.ok) throw new Error(r.error);
  enqueue(itemId, "ocr");
}

async function ocr(itemId: string) {
  const start = findItem(itemId);
  if (!start || start.state !== "ocr") return;
  const provider = deps.ocr();
  if (!provider) throw new Error("no-ocr");
  const store = deps.store();
  const ordered = [...start.pages].sort((a, b) => a.index - b.index);
  for (const page of ordered) {
    const current = findItem(itemId)?.pages.find((p) => p.id === page.id);
    if (!current || current.ocr) continue; // resumable: skip pages already recognised
    const raw = await store.get(current.originalKey);
    if (!raw) throw new Error("original-missing");
    const image = await deps.renderForOcr(raw, current.rotation);
    const done = ordered.filter((p) => findItem(itemId)?.pages.find((x) => x.id === p.id)?.ocr).length;
    const result = await provider.recognize(image, (f) =>
      setProgress(itemId, { stage: `استخراج النص — الصفحة ${current.index + 1} من ${ordered.length}`, fraction: (done + f) / ordered.length }),
    );
    const pageOcr = toPageOcr(result, provider.id);
    const r = mutateItem(itemId, { action: "استخراج نص صفحة", system: true }, (i) => ({
      ...i,
      pages: i.pages.map((p) => (p.id === current.id ? { ...p, ocr: pageOcr } : p)),
    }));
    if (!r.ok) throw new Error(r.error);
  }
  analyze(itemId, "review");
}

/** Runs extraction, classification, duplicates and case matching (idempotent). */
export function analyze(itemId: string, to?: "review") {
  const db = getDB();
  const item = findItem(itemId, db);
  if (!item) return;
  const pages = [...item.pages].sort((a, b) => a.index - b.index);
  const inputs = pages.map((p) => ({ text: p.correctedText ?? p.ocr?.text ?? "", confidence: p.ocr?.confidence ?? 0, uncertain: p.ocr?.uncertain ?? [] }));
  const cases = accessibleCasesForMatching(db);
  const fields = extractFields(inputs, cases);
  const text = inputs.map((p) => p.text).join("\n");
  const classification = classify(text);
  const draft: ArchiveItem = { ...item, fields };
  const others = db.archiveItems.filter((i) => i.tenantId === db.tenantId && i.id !== item.id && i.pages.some((p) => p.ocr));
  const docs = db.documents.filter((d) => d.source === "archive");
  const duplicates = findDuplicates(draft, others, docs);
  const suggestions = matchCases(draft, cases);
  const batch = db.batches.find((b) => b.id === item.batchId);
  if (batch?.defaultCaseId && !suggestions.some((s) => s.caseId === batch.defaultCaseId)) {
    suggestions.push({ caseId: batch.defaultCaseId, score: 0.4, evidence: ["القضية المحددة عند إنشاء الدفعة"] });
  }
  const missingPages = detectMissingPages(inputs.map((p) => p.text));
  const keepHuman = (f: (typeof fields)[number]) => item.fields.find((x) => x.key === f.key && x.source === "human") ?? f;
  mutateItem(itemId, { action: "تحليل آلي: استخراج وتصنيف ورصد تكرار", to, system: !to }, (i) => ({
    ...i,
    fields: fields.map(keepHuman),
    classification: { ...classification, final: i.classification?.final },
    duplicates,
    missingPages,
    // Suggestions only — a case is never assigned automatically.
    caseMatch: { ...i.caseMatch, suggestions },
    error: undefined,
  }));
}

// ——— Recovery ———

export async function retryItem(itemId: string): Promise<ApiResult<ArchiveItem>> {
  const item = findItem(itemId);
  if (!item) return { ok: false, code: "not_found", error: "الوثيقة غير موجودة." };
  if (item.state !== "failed") return { ok: false, code: "validation", error: "إعادة المحاولة متاحة للوثائق التي فشلت معالجتها." };
  const prepared = item.pages.length > 0 && item.pages.every((p) => p.thumbKey);
  if (prepared) {
    const r = mutateItem(itemId, { action: "إعادة محاولة الاستخراج", to: "ocr" }, (i) => ({ ...i, error: undefined }));
    if (r.ok) enqueue(itemId, "ocr");
    return r;
  }
  if (item.originalFileKey && (await deps.store().has(item.originalFileKey))) {
    const r = mutateItem(itemId, { action: "إعادة محاولة التجهيز", to: "uploading" }, (i) => ({ ...i, error: undefined }));
    if (r.ok) enqueue(itemId, "prepare");
    return r;
  }
  const files = sessionFiles.get(itemId);
  if (files) {
    const r = mutateItem(itemId, { action: "إعادة محاولة الرفع", to: "uploading" }, (i) => ({ ...i, error: undefined }));
    if (!r.ok) return r;
    return storeOriginals(itemId, files);
  }
  return { ok: false, code: "validation", error: "الملف الأصلي لم يُحفظ قبل الانقطاع: أعد اختيار نفس الملف لاستئناف المعالجة." };
}

/** Re-attaches the original file after an interrupted upload; must be the same file (hash/size). */
export async function reattachFile(itemId: string, file: File): Promise<ApiResult<ArchiveItem>> {
  const item = findItem(itemId);
  if (!item) return { ok: false, code: "not_found", error: "الوثيقة غير موجودة." };
  if (item.state !== "failed" && item.state !== "uploading") return { ok: false, code: "validation", error: "لا حاجة لإعادة الإرفاق." };
  if (file.size !== item.size) return { ok: false, code: "validation", error: "الملف المختار مختلف عن الملف الأصلي (الحجم غير مطابق)." };
  if (item.sha256 && (await deps.hash(file)) !== item.sha256) return { ok: false, code: "validation", error: "الملف المختار مختلف عن الملف الأصلي (البصمة غير مطابقة)." };
  if (item.state === "failed") {
    const r = mutateItem(itemId, { action: "إعادة إرفاق الملف الأصلي", to: "uploading" }, (i) => ({ ...i, error: undefined }));
    if (!r.ok) return r;
  }
  sessionFiles.set(itemId, [file]);
  return storeOriginals(itemId, [file]);
}

/** Queues OCR again after page edits (rotation/replacement put the item back in "ocr"). */
export function reprocess(itemId: string) {
  const item = findItem(itemId);
  if (item?.state === "ocr") enqueue(itemId, "ocr");
}

/** Called once per tab: re-queues interrupted jobs and flags uploads that never stored their original. */
export function resumeProcessing() {
  const now = Date.now();
  commit((d) => ({
    ...d,
    jobs: d.jobs.map((j) =>
      j.status === "running" && now - new Date(j.heartbeat ?? 0).getTime() > STALE_MS ? { ...j, status: "queued" as const, owner: undefined } : j,
    ),
  }));
  for (const item of getDB().archiveItems) {
    const hasJob = (stage: ProcessingJob["stage"]) => getDB().jobs.some((j) => j.itemId === item.id && j.stage === stage && (j.status === "queued" || j.status === "running"));
    if (item.state === "uploading" && !item.originalFileKey && !sessionFiles.has(item.id)) {
      mutateItem(item.id, { action: "انقطاع الرفع", to: "failed", note: "أُغلقت الصفحة قبل حفظ الملف الأصلي", system: true }, (i) => ({
        ...i,
        error: "انقطع الرفع قبل حفظ الملف الأصلي. أعد اختيار نفس الملف لاستئناف المعالجة.",
      }));
    } else if (item.state === "uploading" && item.originalFileKey && !hasJob("prepare")) enqueue(item.id, "prepare");
    else if (item.state === "ocr" && !hasJob("ocr")) enqueue(item.id, "ocr");
  }
  void runJobs();
}

/** Test helper: waits until the queue is drained. */
export async function drainJobs() {
  for (let i = 0; i < 100; i++) {
    await runJobs();
    if (!getDB().jobs.some((j) => j.status === "queued")) return;
  }
}
