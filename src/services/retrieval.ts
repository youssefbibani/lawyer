/**
 * Archive retrieval.
 *
 * `LocalRetrievalService` is an in-browser lexical index (BM25-style) over the OCR text of
 * demo documents, with Arabic normalisation and a small curated Arabic/French concept map
 * used as *query expansion*. It is not a vector/semantic model; a production deployment
 * should implement `RetrievalService` on the server (OCR text + page metadata, embeddings,
 * hybrid ranking, and permission filtering before ranking).
 */
import type { ArchiveDocument, Citation, SearchRelevance, TeamMember } from "@/types";
import { normalizeText, stemArabic, tokenize } from "@/lib/arabic";
import { accessibleDocuments, currentUser } from "@/services/api";
import { getDB, type DemoDatabase } from "@/services/db";

export interface SearchOptions {
  scope?: "archive" | "all";
  caseId?: string;
  client?: string;
  docType?: string;
  language?: "ar" | "fr" | "all";
  year?: string;
  limit?: number;
}

export interface PageHit {
  page: number;
  lang: "ar" | "fr";
  snippet: string;
  highlights: string[];
  score: number;
}

export interface SearchHit {
  document: ArchiveDocument;
  score: number;
  relevance: SearchRelevance;
  pages: PageHit[];
  bestPage: PageHit;
  matchedTerms: string[];
  /** Matched only through concept expansion, not the literal query terms. */
  expansionOnly: boolean;
  injectionSuspected: boolean;
}

export interface SearchResponse {
  query: string;
  terms: string[];
  expandedTerms: string[];
  hits: SearchHit[];
  engine: "local-lexical" | "remote";
}

export interface RetrievalService {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

/** Bilingual concept groups used for query expansion (stems, normalised). */
const CONCEPTS: string[][] = [
  ["ميراث", "تركه", "ارث", "ورثه", "مورث", "اراثه", "وراثه", "succession", "successoral", "heritiers", "heritage"],
  ["قسمه", "تقسيم", "partage"],
  ["عقار", "عقاري", "immeuble", "foncier"],
  ["طلاق", "divorce"],
  ["تعقيب", "طعن", "cassation", "pourvoi"],
  ["حكم", "قرار", "jugement", "arret"],
  ["شراكه", "شريك", "associe", "societe"],
  ["توريد", "fourniture"],
  ["تعويض", "prejudice", "dommages"],
  ["خبير", "اختبار", "خبره", "expertise", "expert"],
];

const INJECTION_PATTERNS = [
  /تجاهل.{0,20}تعليمات/,
  /ignore.{0,30}instructions/,
  /disregard.{0,30}(instructions|rules)/,
  /system prompt/,
  /you are now/,
  /نظام ا?لي يقرا/,
  /احذف.{0,20}(الجلس|المفكر|الملف)/,
];

export function detectInjection(text: string): boolean {
  const normalized = normalizeText(text);
  return INJECTION_PATTERNS.some((p) => p.test(normalized));
}

/** Splits text into sentences and drops those that look like embedded instructions. */
export function stripInstructionLikeSentences(text: string): { clean: string; removed: number } {
  const sentences = text.split(/(?<=[.!؟?\n])\s*/);
  const kept = sentences.filter((s) => !detectInjection(s));
  return { clean: kept.join(" ").trim(), removed: sentences.length - kept.length };
}

function expand(terms: string[]): string[] {
  const extra = new Set<string>();
  for (const term of terms) {
    for (const group of CONCEPTS) {
      if (group.some((g) => g === term || (term.length >= 4 && g.startsWith(term)))) {
        group.forEach((g) => g !== term && extra.add(g));
      }
    }
  }
  terms.forEach((t) => extra.delete(t));
  return [...extra];
}

function matches(docToken: string, term: string): boolean {
  if (docToken === term) return true;
  return term.length >= 3 && docToken.startsWith(term) && docToken.length - term.length <= 3;
}

function countMatches(tokens: string[], term: string): number {
  let n = 0;
  for (const t of tokens) if (matches(t, term)) n++;
  return n;
}

function bm25(tf: number, idf: number, lengthNorm = 1, k = 1.2): number {
  return tf === 0 ? 0 : idf * ((tf * (k + 1)) / (tf + k * lengthNorm));
}

/** Explainable relevance tiers (shown to users), independent of absolute scores. */
function relevanceOf(exactTf: number, metaExact: number, bestDensity: number, expansionOnly: boolean): SearchRelevance {
  if (expansionOnly) return metaExact > 0 ? "متوسط" : "جزئي";
  if ((exactTf >= 2 && metaExact >= 1) || exactTf >= 3) return "قوي";
  if (metaExact >= 1 || (exactTf >= 1 && bestDensity >= 1 / 45)) return "متوسط";
  return "جزئي";
}

function buildSnippet(text: string, terms: string[]): { snippet: string; highlights: string[] } {
  const sentences = text.split(/(?<=[.!؟?\n،])\s*/).filter((s) => s.trim().length > 0);
  let best = sentences[0] ?? text;
  let bestScore = -1;
  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    const score = terms.reduce((sum, term) => sum + countMatches(tokens, term), 0);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  const snippet = best.length > 240 ? `${best.slice(0, 237)}…` : best;
  const highlights = new Set<string>();
  for (const word of snippet.split(/\s+/)) {
    const stem = stemArabic(normalizeText(word));
    if (stem && terms.some((t) => matches(stem, t))) highlights.add(word.replace(/[«»"'“”؟?!.,،؛;:()]/g, ""));
  }
  return { snippet: snippet.trim(), highlights: [...highlights].filter(Boolean) };
}

function metaText(doc: ArchiveDocument): string {
  return `${doc.title} ${doc.docType} ${doc.client} ${doc.caseRef} ${doc.date.slice(0, 4)} ${(doc.keywords ?? []).join(" ")}`;
}

export function searchDocuments(
  query: string,
  options: SearchOptions = {},
  db: DemoDatabase = getDB(),
  user: TeamMember = currentUser(db),
): SearchResponse {
  const terms = [...new Set(tokenize(query))];
  const expandedTerms = expand(terms);
  if (terms.length === 0) return { query, terms, expandedTerms, hits: [], engine: "local-lexical" };

  // Permission filtering happens BEFORE ranking so restricted files never influence results.
  let corpus = accessibleDocuments(db, user);
  const scope = options.scope ?? "archive";
  if (scope === "archive") corpus = corpus.filter((d) => d.source === "archive");
  if (options.caseId) corpus = corpus.filter((d) => d.caseId === options.caseId);
  if (options.client) corpus = corpus.filter((d) => d.client === options.client);
  if (options.docType) corpus = corpus.filter((d) => d.docType === options.docType);
  if (options.year) corpus = corpus.filter((d) => d.date.startsWith(options.year!));
  if (options.language && options.language !== "all") {
    corpus = corpus.filter((d) => d.language === options.language || d.language === "mixed" || d.pages.some((p) => p.lang === options.language));
  }

  const docTokens = corpus.map((doc) => ({
    doc,
    meta: tokenize(metaText(doc)),
    pages: doc.pages.map((p) => ({ page: p, tokens: tokenize(p.text) })),
  }));

  const allTerms = [...terms.map((t) => ({ term: t, weight: 1 })), ...expandedTerms.map((t) => ({ term: t, weight: 0.45 }))];
  const N = Math.max(docTokens.length, 1);
  const idf = new Map<string, number>();
  for (const { term } of allTerms) {
    const df = docTokens.filter((d) => d.meta.some((t) => matches(t, term)) || d.pages.some((p) => p.tokens.some((t) => matches(t, term)))).length;
    idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)) + 0.2);
  }

  const pageLengths = docTokens.flatMap((d) => d.pages.map((p) => p.tokens.length));
  const avgLen = pageLengths.reduce((a, b) => a + b, 0) / Math.max(pageLengths.length, 1) || 1;

  const hits: SearchHit[] = [];
  for (const entry of docTokens) {
    const matched = new Set<string>();
    let exactMatched = false;
    let exactTf = 0;
    let bestDensity = 0;
    const pageHits: PageHit[] = [];
    for (const { page, tokens } of entry.pages) {
      if (options.language && options.language !== "all" && page.lang !== options.language) continue;
      const lengthNorm = 0.25 + 0.75 * (tokens.length / avgLen);
      let score = 0;
      let pageExact = 0;
      for (const { term, weight } of allTerms) {
        const tf = countMatches(tokens, term);
        if (tf > 0) {
          matched.add(term);
          if (weight === 1) {
            exactMatched = true;
            pageExact += tf;
          }
          score += weight * bm25(tf, idf.get(term) ?? 1, lengthNorm);
        }
      }
      exactTf += pageExact;
      if (tokens.length > 0) bestDensity = Math.max(bestDensity, pageExact / tokens.length);
      if (score > 0) {
        const { snippet, highlights } = buildSnippet(page.text, [...terms, ...expandedTerms]);
        pageHits.push({ page: page.number, lang: page.lang, snippet, highlights, score });
      }
    }
    let metaScore = 0;
    let metaExact = 0;
    for (const { term, weight } of allTerms) {
      const tf = countMatches(entry.meta, term);
      if (tf > 0) {
        matched.add(term);
        if (weight === 1) {
          exactMatched = true;
          metaExact++;
        }
        metaScore += weight * bm25(Math.min(tf, 1), idf.get(term) ?? 1);
      }
    }
    if (pageHits.length === 0 && metaScore === 0) continue;
    pageHits.sort((a, b) => b.score - a.score);
    const first = entry.doc.pages[0];
    const bestPage =
      pageHits[0] ?? {
        page: first?.number ?? 1,
        lang: first?.lang ?? "ar",
        ...buildSnippet(first?.text ?? entry.doc.title, [...terms, ...expandedTerms]),
        score: 0,
      };
    const score = (pageHits[0]?.score ?? 0) + 0.3 * pageHits.slice(1).reduce((s, p) => s + p.score, 0) + 0.6 * metaScore;
    hits.push({
      document: entry.doc,
      score,
      relevance: relevanceOf(exactTf, metaExact, bestDensity, !exactMatched),
      pages: pageHits,
      bestPage,
      matchedTerms: [...matched],
      expansionOnly: !exactMatched,
      injectionSuspected: entry.doc.pages.some((p) => detectInjection(p.text)),
    });
  }

  hits.sort((a, b) => b.score - a.score);

  return { query, terms, expandedTerms, hits: hits.slice(0, options.limit ?? 20), engine: "local-lexical" };
}

export function citationFor(hit: SearchHit, page?: PageHit): Citation {
  const p = page ?? hit.bestPage;
  return {
    documentId: hit.document.id,
    title: `${hit.document.title} — ${hit.document.caseRef}`,
    page: p.page,
    caseId: hit.document.caseId,
    excerpt: p.snippet,
    term: p.highlights[0],
  };
}

export class LocalRetrievalService implements RetrievalService {
  constructor(private readonly latencyMs = 0) {}

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    return searchDocuments(query, options);
  }
}

/** Link to the document viewer opened on a specific page, with the term highlighted. */
export function citationHref(citation: Citation): string {
  if (citation.href) return citation.href;
  const params = new URLSearchParams();
  if (citation.page) params.set("page", String(citation.page));
  if (citation.term) params.set("q", citation.term);
  const qs = params.toString();
  return `/app/document/${citation.documentId}${qs ? `?${qs}` : ""}`;
}
