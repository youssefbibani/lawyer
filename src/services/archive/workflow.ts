import type { ArchiveCategory, ArchiveItemState } from "@/types";
import type { StatusTone } from "@/lib/status";

export const STATE_LABELS: Record<ArchiveItemState, string> = {
  draft: "مسودة",
  uploading: "قيد الرفع",
  ocr: "قيد استخراج النص",
  review: "في انتظار المراجعة",
  needs_correction: "تحتاج إلى تصحيح",
  pending_approval: "في انتظار الموافقة",
  ready: "جاهزة للأرشفة",
  archived: "مؤرشفة",
  failed: "فشلت المعالجة",
};

export const STATE_TONES: Record<ArchiveItemState, StatusTone> = {
  draft: "neutral",
  uploading: "gold",
  ocr: "gold",
  review: "gold",
  needs_correction: "alert",
  pending_approval: "gold",
  ready: "success",
  archived: "success",
  failed: "alert",
};

/**
 * Allowed transitions. Enforced by the archive service for every state change; anything not
 * listed (e.g. review → archived, draft → ready) is rejected.
 */
export const TRANSITIONS: Record<ArchiveItemState, ArchiveItemState[]> = {
  draft: ["uploading", "failed"],
  uploading: ["ocr", "failed"],
  ocr: ["review", "failed"],
  review: ["needs_correction", "pending_approval", "ocr"],
  needs_correction: ["review", "ocr"],
  pending_approval: ["ready", "review"],
  ready: ["archived", "review"],
  archived: [],
  failed: ["uploading", "ocr"],
};

export function canTransition(from: ArchiveItemState, to: ArchiveItemState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const CATEGORY_LABELS: Record<ArchiveCategory, string> = {
  judgment: "أحكام قضائية",
  petition: "عرائض",
  minutes: "محاضر جلسات",
  contract: "عقود",
  correspondence: "مراسلات",
  power_of_attorney: "توكيلات",
  financial: "وثائق مالية",
  other: "وثائق أخرى",
};

/** Document type stored on the archived record (singular form used across the app). */
export const CATEGORY_DOC_TYPE: Record<ArchiveCategory, string> = {
  judgment: "حكم قضائي",
  petition: "عريضة",
  minutes: "محضر جلسة",
  contract: "عقد",
  correspondence: "مراسلة",
  power_of_attorney: "توكيل",
  financial: "وثيقة مالية",
  other: "وثيقة أخرى",
};

/** Dashboard buckets (Step 8). */
export const MONITOR_BUCKETS: { key: string; label: string; states: ArchiveItemState[] }[] = [
  { key: "processing", label: "في انتظار المعالجة", states: ["draft", "uploading", "ocr"] },
  { key: "review", label: "في انتظار المراجعة", states: ["review", "pending_approval"] },
  { key: "ready", label: "جاهزة للحفظ", states: ["ready"] },
  { key: "archived", label: "مؤرشفة", states: ["archived"] },
  { key: "correction", label: "تحتاج إلى تصحيح", states: ["needs_correction", "failed"] },
];

export const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const LOW_CONFIDENCE = 60;

export function validateFile(file: { name: string; type: string; size: number }): string | null {
  if (/\.hei[cf]$/i.test(file.name) || /hei[cf]/.test(file.type)) {
    return `«${file.name}»: صيغة HEIC غير مدعومة للاستخراج. حوّل الصورة إلى JPG أو التقطها من الكاميرا داخل التطبيق.`;
  }
  if (!ACCEPTED_MIME.includes(file.type)) return `«${file.name}»: نوع الملف غير مدعوم (المسموح: PDF، JPG، PNG، WEBP).`;
  if (file.size === 0) return `«${file.name}»: الملف فارغ.`;
  if (file.size > MAX_FILE_BYTES) return `«${file.name}»: الحجم يتجاوز 50 م.ب.`;
  return null;
}
