/**
 * "Fill the new-case form from a photo": reads a photographed document (petition, summons,
 * judgment…) with the OCR engine and turns its text into suggestions for the form's fields.
 *
 * Nothing is filled automatically: the lawyer reviews every suggestion, and the case is only saved
 * when the lawyer presses «حفظ القضية». With the default engine the photo never leaves the device.
 */
import { normalizeText } from "@/lib/arabic";
import { extractFields } from "@/services/archive/analysis";
import { getOcrProvider, toPageOcr } from "@/services/archive/ocr";
import type { CaseType } from "../../../shared/api";

export type ScanKey = "reference" | "court" | "clientName" | "type" | "hearingDate" | "description";

export interface ScanSuggestion {
  key: ScanKey;
  label: string;
  /** Value written into the form. */
  value: string;
  /** How the value is shown when it differs from the stored value (e.g. a case type label). */
  display?: string;
  /** 0–100. */
  confidence: number;
  /** The words of the document the value comes from. */
  evidence?: string;
}

export interface ScanResult {
  suggestions: ScanSuggestion[];
  /** Overall reading confidence of the photo (0–100). */
  readingConfidence: number;
  text: string;
}

const CASE_TYPE_KEYWORDS: [CaseType, string[]][] = [
  ["CASSATION", ["محكمة التعقيب", "الطعن بالتعقيب", "مطلب التعقيب", "cassation"]],
  ["INHERITANCE", ["ميراث", "تركة", "التركة", "الورثة", "ورثة", "قسمة", "succession"]],
  ["FAMILY", ["طلاق", "نفقة", "حضانة", "الأحوال الشخصية", "divorce", "pension alimentaire"]],
  ["LABOR", ["نزاع شغلي", "طرد تعسفي", "دائرة الشغل", "قانون الشغل", "licenciement", "prud"]],
  ["CRIMINAL", ["جزائي", "جنحة", "جناية", "النيابة العمومية", "pénal", "correctionnel"]],
  ["ADMINISTRATIVE", ["المحكمة الإدارية", "نزاع إداري", "tribunal administratif"]],
  ["REAL_ESTATE", ["عقاري", "رسم عقاري", "المحكمة العقارية", "عقار", "immobilier", "titre foncier"]],
  ["COMMERCIAL", ["تجاري", "الدائرة التجارية", "شركة", "كمبيالة", "commercial", "société"]],
  ["CIVIL", ["مدني", "الدائرة المدنية", "تعويض", "civil"]],
];

const TYPE_LABELS: Record<CaseType, string> = {
  INHERITANCE: "نزاع ميراث",
  CIVIL: "قضية مدنية",
  CASSATION: "طعن تعقيبي",
  COMMERCIAL: "قضية تجارية",
  REAL_ESTATE: "قضية عقارية",
  CRIMINAL: "قضية جزائية",
  ADMINISTRATIVE: "قضية إدارية",
  LABOR: "نزاع شغلي",
  FAMILY: "أحوال شخصية",
  OTHER: "أخرى",
};

/** Most likely case type from the keywords present in the document. */
export function inferCaseType(text: string): { type: CaseType; confidence: number; evidence: string } | null {
  const n = normalizeText(text);
  const scored = CASE_TYPE_KEYWORDS.map(([type, words]) => {
    const found = words.filter((w) => n.includes(normalizeText(w)));
    return { type, found, score: found.length };
  }).sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top || top.score === 0) return null;
  const margin = top.score - (second?.score ?? 0);
  return { type: top.type, confidence: Math.min(90, 45 + top.score * 10 + margin * 10), evidence: top.found.slice(0, 3).join("، ") };
}

/** Turns the text of one photographed page into form suggestions. */
export function suggestionsFromText(text: string, readingConfidence: number, uncertain: string[], today: string): ScanSuggestion[] {
  const out: ScanSuggestion[] = [];
  const fields = extractFields([{ text, confidence: readingConfidence, uncertain }], []);
  const field = (key: string) => fields.find((f) => f.key === key);

  const ref = field("caseRef");
  if (ref) out.push({ key: "reference", label: "عدد القضية", value: ref.value, confidence: ref.confidence, evidence: ref.evidence });

  const parties = field("parties");
  if (parties) {
    const first = parties.value.split("،")[0].trim();
    if (first) out.push({ key: "clientName", label: "اسم الحريف", value: first, confidence: Math.min(parties.confidence, 75), evidence: parties.evidence });
  }

  const type = inferCaseType(text);
  if (type) out.push({ key: "type", label: "نوع القضية", value: type.type, display: TYPE_LABELS[type.type], confidence: type.confidence, evidence: type.evidence });

  const court = field("court");
  if (court) out.push({ key: "court", label: "المحكمة", value: court.value, confidence: court.confidence, evidence: court.evidence });

  // A date in the future is most likely the next hearing; a past one is the document's own date.
  const date = field("date");
  if (date && date.value >= today) out.push({ key: "hearingDate", label: "الجلسة الأولى", value: date.value, confidence: Math.min(date.confidence, 70), evidence: date.evidence });

  const title = field("title");
  if (title) out.push({ key: "description", label: "وصف مختصر", value: title.value, confidence: Math.min(title.confidence, 60), evidence: title.value });

  return out;
}

export class ScanUnavailableError extends Error {}

/** Reads the photo and returns suggestions. Throws when no OCR engine is available. */
export async function scanCaseDocument(image: Blob, today: string, onProgress?: (fraction: number) => void): Promise<ScanResult> {
  const ocr = getOcrProvider();
  if (!ocr) throw new ScanUnavailableError("قراءة الوثائق غير مهيأة على هذا الحساب.");
  const result = await ocr.recognize(image, onProgress);
  const page = toPageOcr(result, ocr.id);
  return { suggestions: suggestionsFromText(page.text, page.confidence, page.uncertain, today), readingConfidence: page.confidence, text: page.text };
}
