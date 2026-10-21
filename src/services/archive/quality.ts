/**
 * Scan quality heuristics on raw pixels (pure functions — testable without a browser canvas).
 *  - blank: almost no ink and little contrast
 *  - blurry: low variance of the Laplacian (classic focus measure) on a downscaled grayscale image
 *  - low contrast: very narrow luminance spread
 * And page-numbering analysis on OCR text to flag potentially missing pages.
 */
import type { PageQuality } from "@/types";

export interface PixelData {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Calibrated on synthetic and real scans: sharp pages score > 190k, blurred text < 6k. */
export const BLUR_THRESHOLD = 20_000;

export function analyzePixels(img: PixelData): PageQuality {
  const { data, width, height } = img;
  const n = width * height;
  if (n === 0) return { analyzed: false };
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  const mean = sum / n;
  // Paper background ≈ the bright end of the histogram; "ink" = clearly darker than the paper,
  // so blurred (grey) strokes still count as content rather than an empty page.
  const sorted = Float32Array.from(gray).sort();
  const paper = sorted[Math.floor(n * 0.9)];
  let varSum = 0;
  let ink = 0;
  for (let i = 0; i < n; i++) {
    varSum += (gray[i] - mean) ** 2;
    if (paper - gray[i] > 25) ink++;
  }
  const std = Math.sqrt(varSum / n);
  const inkRatio = ink / n;

  // Laplacian variance (4-neighbour kernel).
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      lapSum += lap;
      lapSq += lap * lap;
      count++;
    }
  }
  const lapMean = count ? lapSum / count : 0;
  const sharpness = count ? lapSq / count - lapMean ** 2 : 0;

  const blank = inkRatio < 0.002 || std < 4;
  // Edge energy per unit of ink: independent of how much text the page carries.
  const focus = sharpness / Math.max(inkRatio, 0.001);
  return {
    analyzed: true,
    blank,
    blurry: !blank && focus < BLUR_THRESHOLD,
    lowContrast: !blank && paper - sorted[Math.floor(n * 0.001)] < 70,
    sharpness: Math.round(focus),
    inkRatio: Math.round(inkRatio * 1000) / 1000,
  };
}

const PAGE_PATTERNS = [
  /(?:الصفحة|صفحة|ص)\s*[:.]?\s*(\d{1,3})\s*(?:من|\/)\s*(\d{1,3})/,
  /\bpage\s*(\d{1,3})\s*(?:sur|\/|of)\s*(\d{1,3})/i,
  /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/m,
];

/**
 * Detects page numbers printed on scanned pages ("صفحة 2 من 4", "page 2/4").
 * Returns the page numbers that appear to be missing, or [] when nothing can be inferred.
 */
export function detectMissingPages(pageTexts: string[]): number[] {
  const seen = new Set<number>();
  const unnumbered: number[] = [];
  let declaredTotal = 0;
  pageTexts.forEach((text, physical) => {
    let found = false;
    const normalized = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    for (const rx of PAGE_PATTERNS) {
      const m = normalized.match(rx);
      if (m) {
        const page = Number(m[1]);
        const total = Number(m[2]);
        if (page >= 1 && total >= page && total <= 500) {
          seen.add(page);
          declaredTotal = Math.max(declaredTotal, total);
          found = true;
        }
        break;
      }
    }
    if (!found) unnumbered.push(physical + 1);
  });
  if (!declaredTotal) return [];
  // OCR often misses a footer: an unnumbered scanned page is assumed to sit at its physical position.
  for (const p of unnumbered) if (!seen.has(p)) seen.add(p);
  const missing: number[] = [];
  for (let p = 1; p <= declaredTotal; p++) if (!seen.has(p)) missing.push(p);
  // Only report when the scan is shorter than the declared total (avoids noise from unnumbered pages).
  return pageTexts.length < declaredTotal ? missing : [];
}
