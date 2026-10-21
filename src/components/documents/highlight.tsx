import type { ReactNode } from "react";

const VARIANTS: Record<string, string> = {
  ا: "[اأإآٱ]",
  أ: "[اأإآٱ]",
  إ: "[اأإآٱ]",
  آ: "[اأإآٱ]",
  ه: "[هة]",
  ة: "[هة]",
  ي: "[يى]",
  ى: "[يى]",
};

/** Builds a regex that matches Arabic text regardless of diacritics and letter variants. */
export function arabicTolerantRegex(term: string): RegExp | null {
  const clean = term.replace(/[ً-ٰٟـ]/g, "").trim();
  if (!clean) return null;
  const body = [...clean]
    .map((ch) => {
      if (/\s/.test(ch)) return "\\s+";
      const v = VARIANTS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `${v}[\\u064B-\\u065F\\u0670\\u0640]*`;
    })
    .join("");
  return new RegExp(body, "gi");
}

export function countMatches(text: string, term: string): number {
  const rx = arabicTolerantRegex(term);
  return rx ? (text.match(rx) ?? []).length : 0;
}

/** Splits text into highlighted runs. `activeIndex` (local to this text) gets a stronger mark. */
export function highlightText(text: string, terms: string[], activeIndex = -1, markIdPrefix?: string): ReactNode {
  const patterns = terms.map(arabicTolerantRegex).filter((r): r is RegExp => !!r);
  if (!patterns.length) return text;
  const combined = new RegExp(patterns.map((p) => p.source).join("|"), "gi");
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(combined)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const active = i === activeIndex;
    out.push(
      <mark
        key={`${start}-${i}`}
        id={markIdPrefix ? `${markIdPrefix}-${i}` : undefined}
        className={active ? "rounded-sm bg-gold px-0.5 text-ink ring-2 ring-gold-deep" : "rounded-sm bg-gold/25 px-0.5 text-inherit"}
      >
        {m[0]}
      </mark>,
    );
    last = start + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
