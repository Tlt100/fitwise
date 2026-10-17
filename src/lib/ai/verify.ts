/**
 * Grounding checks: does what the model says about the resume actually appear
 * in the resume? Pure functions, no I/O, safe on client and server.
 *
 * Quotes are compared as token sets, not strings, so a quote survives PDF
 * line-wrapping, re-ordered punctuation, a dropped bullet glyph or an
 * inflection ("managed" vs "manage"). A quote is verified when at least 80% of
 * its distinct content words occur together inside one window of the source
 * roughly the quote's own length -- so words scattered across the whole
 * resume do not add up to a false match.
 */
import type { Analysis } from "@/lib/ai/analysis-schema";
import type { MatchResult } from "@/lib/match/keywords";
import { normKey, normalizeText, STOPWORDS, tokenize } from "@/lib/match/stem";

export const QUOTE_THRESHOLD = 0.8;

export interface QuoteCheck {
  quote: string;
  verified: boolean;
  /** 0-1: share of the quote's distinct content words found together. */
  score: number;
}

export interface VerificationReport {
  evidenceChecked: number;
  evidenceVerified: number;
  rewritesChecked: number;
  /** Rewrites removed because their `original` is not in the resume. */
  rewritesDropped: number;
  /** Rewrites kept but flagged for introducing figures. */
  rewritesWithNewNumbers: number;
  /** Keyword flags from the model that disagreed with the deterministic match. */
  keywordFlagsCorrected: number;
}

function contentStems(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t.norm) && /[a-z0-9]/i.test(t.norm))
    .map((t) => t.stem);
}

/** Prepared source text, so many quotes can be checked against it cheaply. */
export interface PreparedSource {
  stems: string[];
}

export function prepareSource(sourceText: string): PreparedSource {
  return { stems: contentStems(sourceText) };
}

/**
 * Best share of the quote's distinct content words found within one sliding
 * window of the source. Returns 0 for an empty quote.
 */
export function quoteSupportScore(quote: string, source: PreparedSource | string): number {
  const prepared = typeof source === "string" ? prepareSource(source) : source;
  const sequence = contentStems(quote);
  const wanted = new Set(sequence);
  if (wanted.size === 0 || prepared.stems.length === 0) return 0;

  const stems = prepared.stems;
  const windowSize = Math.max(Math.ceil(sequence.length * 1.5) + 2, 6);
  const counts = new Map<string, number>();
  let distinct = 0;
  let best = 0;

  for (let i = 0; i < stems.length; i += 1) {
    const incoming = stems[i];
    if (wanted.has(incoming)) {
      const c = counts.get(incoming) ?? 0;
      if (c === 0) distinct += 1;
      counts.set(incoming, c + 1);
    }
    const outgoingIndex = i - windowSize;
    if (outgoingIndex >= 0) {
      const outgoing = stems[outgoingIndex];
      if (wanted.has(outgoing)) {
        const c = (counts.get(outgoing) ?? 0) - 1;
        counts.set(outgoing, c);
        if (c === 0) distinct -= 1;
      }
    }
    if (distinct > best) {
      best = distinct;
      if (best === wanted.size) break;
    }
  }

  return best / wanted.size;
}

/** Check each quote against the source text. Reusable by any feature. */
export function verifyQuotes(
  quotes: readonly string[],
  sourceText: string,
  threshold = QUOTE_THRESHOLD,
): QuoteCheck[] {
  const prepared = prepareSource(sourceText);
  return quotes.map((quote) => {
    const score = Math.round(quoteSupportScore(quote, prepared) * 1000) / 1000;
    return { quote, verified: score >= threshold, score };
  });
}

const NUMBER_WORDS = new Set(
  (
    "two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty " +
    "hundred hundreds thousand thousands million millions billion billions dozen dozens " +
    "double doubled triple tripled quadrupled halved twofold threefold tenfold"
  ).split(" "),
);

function numbersIn(text: string): { value: string; display: string }[] {
  const normalized = normalizeText(text);
  const found: { value: string; display: string }[] = [];
  for (const m of normalized.matchAll(/[$£€]?\d+(?:[.,]\d+)*\s?(?:%|[kKmMbB]\b|x\b)?/g)) {
    const digits = m[0].replace(/[^\d.]/g, "").replace(/\.$/, "");
    if (digits) found.push({ value: digits.replace(/^0+(?=\d)/, ""), display: m[0].trim() });
  }
  for (const word of normalized.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (NUMBER_WORDS.has(word)) found.push({ value: word, display: word });
  }
  return found;
}

/**
 * Figures in `suggested` that do not appear in `original`: digits (with any
 * currency, percent or k/m/b suffix) and number words ("doubled", "dozens").
 * Returns the rewrite's own spelling of each, de-duplicated.
 */
export function findUnverifiedNumbers(suggested: string, original: string): string[] {
  const known = new Set(numbersIn(original).map((n) => n.value));
  const out: string[] = [];
  for (const n of numbersIn(suggested)) {
    if (!known.has(n.value) && !out.includes(n.display)) out.push(n.display);
  }
  return out;
}

/**
 * Bring the model's `presentInResume` flags into line with the deterministic
 * keyword match wherever both talk about the same term. Returns the corrected
 * keywords and how many flags changed.
 */
export function reconcileKeywords(
  keywords: Analysis["keywords"],
  match: MatchResult | null | undefined,
): { keywords: Analysis["keywords"]; corrected: number } {
  if (!match) return { keywords, corrected: 0 };
  const byName = new Map(match.terms.map((t) => [normKey(t.term), t]));
  let corrected = 0;
  const next = keywords.map((k) => {
    const term = byName.get(normKey(k.keyword));
    if (!term) return k;
    const present = term.status !== "missing";
    if (present === k.presentInResume) return k;
    corrected += 1;
    return { ...k, presentInResume: present };
  });
  return { keywords: next, corrected };
}

/**
 * Check an analysis against the resume it claims to describe:
 *
 * - every `matchedSkills[].evidence` gets `verified: true` when it is found
 *   in the resume (>= 0.8 token-set match), `false` when it reads as a
 *   paraphrase or cannot be found;
 * - every `bulletRewrites[]` whose `original` is not found is dropped, since
 *   a rewrite of a line the resume does not contain is a fabrication;
 * - every kept rewrite whose `suggested` introduces figures absent from its
 *   `original` gets `addsUnverifiedNumbers: true` and the list of figures;
 * - when a keyword match is supplied, the model's keyword flags are corrected
 *   to agree with it.
 */
export function verifyAnalysis(
  analysis: Analysis,
  resumeText: string,
  match?: MatchResult | null,
): { analysis: Analysis; report: VerificationReport } {
  const prepared = prepareSource(resumeText);

  const matchedSkills = analysis.matchedSkills.map((skill) => ({
    ...skill,
    verified: quoteSupportScore(skill.evidence, prepared) >= QUOTE_THRESHOLD,
  }));

  const bulletRewrites: Analysis["bulletRewrites"] = [];
  let rewritesDropped = 0;
  let rewritesWithNewNumbers = 0;
  for (const rewrite of analysis.bulletRewrites) {
    if (quoteSupportScore(rewrite.original, prepared) < QUOTE_THRESHOLD) {
      rewritesDropped += 1;
      continue;
    }
    const unverifiedNumbers = findUnverifiedNumbers(rewrite.suggested, rewrite.original);
    if (unverifiedNumbers.length) rewritesWithNewNumbers += 1;
    bulletRewrites.push({
      ...rewrite,
      addsUnverifiedNumbers: unverifiedNumbers.length > 0,
      unverifiedNumbers,
    });
  }

  const { keywords, corrected } = reconcileKeywords(analysis.keywords, match);

  return {
    analysis: { ...analysis, matchedSkills, bulletRewrites, keywords },
    report: {
      evidenceChecked: matchedSkills.length,
      evidenceVerified: matchedSkills.filter((s) => s.verified).length,
      rewritesChecked: analysis.bulletRewrites.length,
      rewritesDropped,
      rewritesWithNewNumbers,
      keywordFlagsCorrected: corrected,
    },
  };
}
