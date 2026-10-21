/**
 * Arabic / French text utilities used by search, intent detection and highlighting.
 * Normalisation is deliberately conservative: it only folds orthographic variants
 * that Tunisian lawyers commonly type interchangeably.
 */

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = /[٠-٩]/g;
const EASTERN_INDIC = /[۰-۹]/g;

export function toLatinDigits(value: string): string {
  return value
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Folds Arabic letter variants, strips diacritics, lowercases Latin and removes French accents. */
export function normalizeText(value: string): string {
  return toLatinDigits(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[«»"'“”؟?!.,،؛;:()[\]{}…\-–—_/\\]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ARABIC_STOPWORDS = new Set([
  "في", "من", "على", "الى", "عن", "مع", "او", "ان", "هذا", "هذه", "ذلك", "التي", "الذي",
  "و", "ثم", "قد", "كل", "بين", "عند", "اللي", "متاع", "هو", "هي", "ما", "لا", "يا",
  "le", "la", "les", "de", "des", "du", "et", "en", "un", "une", "au", "aux", "par", "pour", "sur", "dans",
]);

/** Removes common Arabic proclitics so "والميراث" / "بالميراث" match "ميراث". */
export function stemArabic(token: string): string {
  if (!/[؀-ۿ]/.test(token) || token.length <= 3) return token;
  let t = token;
  for (const prefix of ["وال", "بال", "كال", "فال", "لل", "ال"]) {
    if (t.startsWith(prefix) && t.length - prefix.length >= 3) {
      t = t.slice(prefix.length);
      break;
    }
  }
  if (t.length > 4 && (t.startsWith("و") || t.startsWith("ب"))) {
    const rest = t.slice(1);
    if (rest.length >= 3) t = rest;
  }
  return t;
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length > 1 && !ARABIC_STOPWORDS.has(t))
    .map(stemArabic);
}

export function containsArabic(value: string): boolean {
  return /[؀-ۿ]/.test(value);
}
