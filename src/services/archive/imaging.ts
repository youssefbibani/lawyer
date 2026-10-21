/**
 * Browser imaging: decode images (EXIF-aware), rasterise PDF pages with pdf.js, build thumbnails,
 * rotate pages for OCR and measure scan quality. Heavy libraries are loaded on demand.
 */
import type { PageQuality } from "@/types";
import { analyzePixels } from "@/services/archive/quality";

export interface RasterPage {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  quality: PageQuality;
}

const OCR_MAX = 2200;
const THUMB_MAX = 240;
const MAX_PDF_PAGES = 300;

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function toBlob(c: HTMLCanvasElement, type = "image/jpeg", quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode-failed"))), type, quality));
}

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaled(source: CanvasImageSource & { width: number; height: number }, max: number): HTMLCanvasElement {
  const ratio = Math.min(1, max / Math.max(source.width, source.height));
  const c = canvas(source.width * ratio, source.height * ratio);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function measureQuality(source: HTMLCanvasElement): PageQuality {
  try {
    const small = scaled(source, 400);
    const data = small.getContext("2d")!.getImageData(0, 0, small.width, small.height);
    return analyzePixels(data);
  } catch {
    return { analyzed: false };
  }
}

async function pageFromCanvas(c: HTMLCanvasElement): Promise<RasterPage> {
  return {
    blob: await toBlob(c, "image/jpeg", 0.92),
    thumb: await toBlob(scaled(c, THUMB_MAX), "image/jpeg", 0.7),
    width: c.width,
    height: c.height,
    quality: measureQuality(c),
  };
}

export async function rasterize(file: Blob, mime: string, onPage?: (done: number, total: number) => void): Promise<RasterPage[]> {
  if (mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const total = Math.min(doc.numPages, MAX_PDF_PAGES);
    const pages: RasterPage[] = [];
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 1700 / base.width) });
      const c = canvas(viewport.width, viewport.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push(await pageFromCanvas(c));
      onPage?.(i, total);
      page.cleanup();
    }
    await doc.destroy();
    return pages;
  }
  const image = await decode(file);
  const page = await pageFromCanvas(scaled(image, OCR_MAX));
  onPage?.(1, 1);
  return [page];
}

/** Applies the page rotation before OCR (originals stay untouched). */
export async function renderForOcr(blob: Blob, rotation: number): Promise<Blob> {
  if (!rotation) return blob;
  const image = await decode(blob);
  const swap = rotation === 90 || rotation === 270;
  const c = canvas(swap ? image.height : image.width, swap ? image.width : image.height);
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return toBlob(c, "image/png");
}
