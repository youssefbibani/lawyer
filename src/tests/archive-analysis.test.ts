import { describe, it, expect } from "vitest";

import { analyzePixels, detectMissingPages } from "@/services/archive/quality";
import { classify, extractFields, findDates, textSimilarity } from "@/services/archive/analysis";
import { createSeed } from "@/services/db";

// Verbatim Tesseract output captured during the real end-to-end run (headless Chrome, ara+fra).
const REAL_AR_P1 =
  "الجمهورية التونسية\n\nمحكمة التعقيب\n\nالقضية عدد ‎CC/2019/0124‏\n\nحكم بتاريخ 12 جوان 2019 في حق ورثة عائلة بن صالح\nوحيث أن النزاع يتعلق بقسمة التركة بين الورثة\n\nصفحة 1 من 3";
const REAL_AR_P2 = "لهذه الأسباب حكمت المحكمة بتأييد الحكم الابتدائي\nفي قسمة التركة بين الورثة";
const REAL_FR =
  "Cour d'appel de Tunis\nRequête du 3 mars 2020\nAu nom de M. Sami Mourad\nObjet : demande de dommages et liquidation du compte\n‏إلى السيد سامي مراد المحترم‎";

const cases = createSeed(new Date(2026, 9, 18)).cases.filter((c) => c.team.includes("u1"));

describe("extraction on real OCR output", () => {
  it("extracts reference, date, court and client from an Arabic judgment", () => {
    const fields = extractFields(
      [
        { text: REAL_AR_P1, confidence: 92, uncertain: [] },
        { text: REAL_AR_P2, confidence: 91, uncertain: [] },
      ],
      cases,
    );
    const v = (k: string) => fields.find((f) => f.key === k)?.value;
    expect(v("caseRef")).toBe("CC/2019/0124");
    expect(v("date")).toBe("2019-06-12");
    expect(v("court")).toBe("محكمة التعقيب");
    expect(v("client")).toBe("عائلة بن صالح");
    // Letterhead lines are not used as the document title.
    expect(v("title")).toBe("محكمة التعقيب");
    expect(v("parties")).not.toContain("وحيث");
  });

  it("does not let a French party name run onto the next line", () => {
    const fields = extractFields([{ text: REAL_FR, confidence: 95, uncertain: [] }], cases);
    const parties = fields.find((f) => f.key === "parties")?.value ?? "";
    expect(parties).toContain("Sami Mourad");
    expect(parties).not.toContain("Objet");
    expect(fields.find((f) => f.key === "date")?.value).toBe("2020-03-03");
    expect(fields.find((f) => f.key === "client")?.value).toBe("سامي مراد");
  });

  it("lowers field confidence when the OCR flagged the words as uncertain", () => {
    const sure = extractFields([{ text: REAL_AR_P1, confidence: 90, uncertain: [] }], cases).find((f) => f.key === "date")!;
    const shaky = extractFields([{ text: REAL_AR_P1, confidence: 90, uncertain: ["جوان"] }], cases).find((f) => f.key === "date")!;
    expect(shaky.confidence).toBeLessThan(sure.confidence);
    expect(shaky.confidence).toBeLessThan(60);
  });

  it("classifies the real judgment as a judgment with evidence", () => {
    const c = classify(`${REAL_AR_P1}\n${REAL_AR_P2}`);
    expect(c.suggested).toBe("judgment");
    expect(c.evidence.join(" ")).toContain("لهذه الأسباب");
  });

  it("parses Arabic, French and numeric dates and prefers anchored ones", () => {
    expect(findDates("صدر 5/11/2018 ثم بتاريخ 12 جوان 2019")[0].iso).toBe("2019-06-12");
    expect(findDates("Tunis, le 1er décembre 2021")[0].iso).toBe("2021-12-01");
    expect(findDates("31/02/2020")).toHaveLength(0);
  });

  it("measures text similarity for near-duplicate detection", () => {
    expect(textSimilarity(REAL_AR_P1, REAL_AR_P1)).toBe(1);
    expect(textSimilarity(REAL_AR_P1, REAL_FR)).toBeLessThan(0.1);
  });
});

describe("missing pages", () => {
  it("counts an unnumbered page at its physical position (OCR missed its footer)", () => {
    // Real case: page 2's "صفحة 2 من 3" footer was not recognised.
    expect(detectMissingPages([REAL_AR_P1, REAL_AR_P2])).toEqual([3]);
  });

  it("reports nothing when no numbering is printed or the scan is complete", () => {
    expect(detectMissingPages(["نص بدون ترقيم", "نص آخر"])).toEqual([]);
    expect(detectMissingPages(["صفحة 1 من 2", "صفحة 2 من 2"])).toEqual([]);
    expect(detectMissingPages(["page 1/4", "page 4/4"])).toEqual([2, 3]);
  });
});

describe("scan quality on pixels", () => {
  function image(width: number, height: number, pixel: (x: number, y: number) => number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = pixel(x, y);
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    return { data, width, height };
  }

  it("detects a blank page", () => {
    expect(analyzePixels(image(120, 160, () => 250)).blank).toBe(true);
  });

  it("detects a blurry page and accepts a sharp one", () => {
    // Sharp: thin black text-like strokes on white.
    const sharp = analyzePixels(image(120, 160, (x, y) => (y % 12 < 2 && x % 9 < 6 ? 0 : 255)));
    expect(sharp.blank).toBe(false);
    expect(sharp.blurry).toBe(false);
    // Blurry: the same strokes after a box blur — must be "blurry", never "blank".
    const strokes = image(120, 160, (x, y) => (y % 12 < 2 && x % 9 < 6 ? 0 : 255));
    const blurred = { ...strokes, data: new Uint8ClampedArray(strokes.data.length) };
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 120; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < 120 && yy < 160) {
              sum += strokes.data[(yy * 120 + xx) * 4];
              count++;
            }
          }
        const i = (y * 120 + x) * 4;
        blurred.data[i] = blurred.data[i + 1] = blurred.data[i + 2] = sum / count;
        blurred.data[i + 3] = 255;
      }
    const blurry = analyzePixels(blurred);
    expect(blurry.blank).toBe(false);
    expect(blurry.blurry).toBe(true);
    // A crisp page with a single line of text is neither blurry nor low-contrast.
    const sparse = analyzePixels(image(300, 400, (x, y) => (y > 20 && y < 24 && x > 10 && x < 290 && x % 7 < 4 ? 0 : 255)));
    expect(sparse.blurry).toBe(false);
    expect(sparse.lowContrast).toBe(false);
  });
});
