/**
 * Search normalisation for Arabic and Latin text: removes diacritics and tatweel, unifies
 * alef / yaa / taa-marbuta variants and Arabic-Indic digits, lower-cases Latin letters.
 * The same function is applied to stored search columns and to queries.
 */
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeSearch(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchText(...parts: (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

/** Trims and converts empty strings to null for optional text fields. */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
