/**
 * OCR providers.
 *
 * - TesseractOcrProvider: real OCR in the browser (WebAssembly in a Web Worker) with the Arabic and
 *   French models loaded together, so mixed documents are recognised in one pass. Images never
 *   leave the device; the first run downloads the engine and language models (from jsDelivr by
 *   default, or VITE_OCR_LANG_PATH to self-host them).
 * - ServerOcrProvider: posts page images to VITE_OCR_API_URL (expects { text, confidence, words }).
 * Results are never fabricated: failures propagate and the document goes to "فشلت المعالجة".
 */
import type { OcrWord, PageOcr } from "@/types";
import { LOW_CONFIDENCE } from "@/services/archive/workflow";

const env = import.meta.env;
export const ocrConfig = {
  engine: ((env.VITE_OCR_ENGINE as string | undefined) ?? "local") as "local" | "server" | "none",
  apiUrl: (env.VITE_OCR_API_URL as string | undefined) ?? "",
  langPath: (env.VITE_OCR_LANG_PATH as string | undefined) || undefined,
};

export interface OcrResult {
  text: string;
  confidence: number;
  words: OcrWord[];
}

export interface OcrProvider {
  id: string;
  label: string;
  /** True when images are processed on this device. */
  local: boolean;
  recognize(image: Blob, onProgress?: (fraction: number) => void): Promise<OcrResult>;
}

export function detectLanguage(text: string): PageOcr["lang"] {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const total = arabic + latin;
  if (total < 10) return "unknown";
  if (arabic / total > 0.85) return "ar";
  if (latin / total > 0.85) return "fr";
  return "mixed";
}

export function toPageOcr(result: OcrResult, engine: string): PageOcr {
  return {
    engine,
    text: result.text.trim(),
    confidence: Math.round(result.confidence),
    lang: detectLanguage(result.text),
    uncertain: [...new Set(result.words.filter((w) => w.confidence < LOW_CONFIDENCE && w.text.trim().length > 1).map((w) => w.text.trim()))].slice(0, 200),
    at: new Date().toISOString(),
  };
}

type TesseractWorker = {
  recognize: (image: Blob, options?: object, output?: object) => Promise<{ data: TesseractData }>;
  terminate: () => Promise<unknown>;
};
type TesseractWordLike = { text: string; confidence: number };
type TesseractData = {
  text: string;
  confidence: number;
  words?: TesseractWordLike[];
  blocks?: { paragraphs?: { lines?: { words?: TesseractWordLike[] }[] }[] }[] | null;
};

export class TesseractOcrProvider implements OcrProvider {
  id = "tesseract";
  label = "Tesseract — محلي على هذا الجهاز (عربي + فرنسي)";
  local = true;
  private worker?: Promise<TesseractWorker>;
  private progress?: (f: number) => void;
  private idleTimer?: ReturnType<typeof setTimeout>;

  private getWorker(): Promise<TesseractWorker> {
    this.worker ??= (async () => {
      const Tesseract = await import("tesseract.js");
      const w = await Tesseract.createWorker(["ara", "fra"], 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") this.progress?.(m.progress);
        },
        ...(ocrConfig.langPath ? { langPath: ocrConfig.langPath } : {}),
      });
      return w as unknown as TesseractWorker;
    })();
    this.worker.catch(() => (this.worker = undefined));
    return this.worker;
  }

  async recognize(image: Blob, onProgress?: (fraction: number) => void): Promise<OcrResult> {
    clearTimeout(this.idleTimer);
    const worker = await this.getWorker();
    this.progress = onProgress;
    try {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const words =
        data.words && data.words.length
          ? data.words
          : (data.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? [])));
      return { text: data.text ?? "", confidence: data.confidence ?? 0, words: words.map((w) => ({ text: w.text, confidence: w.confidence })) };
    } finally {
      this.progress = undefined;
      // Free the WebAssembly memory after a period of inactivity.
      this.idleTimer = setTimeout(() => {
        this.worker?.then((w) => w.terminate());
        this.worker = undefined;
      }, 120_000);
    }
  }
}

export class ServerOcrProvider implements OcrProvider {
  id = "server";
  label = "خادم OCR للمكتب";
  local = false;
  constructor(private readonly url: string) {}

  async recognize(image: Blob): Promise<OcrResult> {
    const form = new FormData();
    form.append("image", image, "page.png");
    form.append("langs", "ara+fra");
    const res = await fetch(this.url, { method: "POST", body: form, credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Partial<OcrResult>;
    if (typeof data.text !== "string") throw new Error("invalid-response");
    return { text: data.text, confidence: data.confidence ?? 0, words: data.words ?? [] };
  }
}

let provider: OcrProvider | null | undefined;

export function getOcrProvider(): OcrProvider | null {
  if (provider === undefined) {
    if (ocrConfig.engine === "server" && ocrConfig.apiUrl) provider = new ServerOcrProvider(ocrConfig.apiUrl);
    else if (ocrConfig.engine === "local" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined") provider = new TesseractOcrProvider();
    else provider = null;
  }
  return provider;
}

export function setOcrProvider(next: OcrProvider | null) {
  provider = next;
}
