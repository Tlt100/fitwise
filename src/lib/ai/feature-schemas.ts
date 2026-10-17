import {
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_RESUME_CHARS,
  MIN_RESUME_CHARS,
} from "@/lib/limits";
import { z } from "zod";

/**
 * Contracts and grounding checks for the cover-letter and rewrite features.
 *
 * Pure module: no server-only imports, so the request types can be shared with
 * the client and every check here runs under Vitest without mocks.
 *
 * The model is asked to cite the resume line behind each claim. Nothing it
 * cites is trusted: every quote is checked against the resume text, and every
 * number in the output is checked against the numbers the user actually wrote.
 */

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

export const COVER_LETTER_TONES = ["professional", "warm", "direct"] as const;
export const COVER_LETTER_LENGTHS = [150, 250, 350] as const;
export const REWRITE_KINDS = ["summary", "linkedin-headline", "linkedin-about"] as const;

export type CoverLetterTone = (typeof COVER_LETTER_TONES)[number];
export type CoverLetterLength = (typeof COVER_LETTER_LENGTHS)[number];
export type RewriteKind = (typeof REWRITE_KINDS)[number];

export const MAX_ANALYSIS_SUMMARY_CHARS = 4_000;
export const MAX_WHY_COMPANY_CHARS = 1_200;
export const MIN_FEATURE_JOB_DESCRIPTION_CHARS = 40;

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value && value.trim() ? value.trim() : undefined));

export const coverLetterRequestSchema = z.object({
  resumeText: z.string().min(MIN_RESUME_CHARS).max(MAX_RESUME_CHARS),
  jobDescription: z.string().min(MIN_FEATURE_JOB_DESCRIPTION_CHARS).max(MAX_JOB_DESCRIPTION_CHARS),
  analysisSummary: optionalText(MAX_ANALYSIS_SUMMARY_CHARS),
  options: z
    .object({
      tone: z.enum(COVER_LETTER_TONES).default("professional"),
      length: z
        .union([z.literal(150), z.literal(250), z.literal(350)])
        .default(250),
      companyName: optionalText(120),
      hiringManager: optionalText(120),
      whyThisCompany: optionalText(MAX_WHY_COMPANY_CHARS),
    })
    .default({
      tone: "professional",
      length: 250,
      companyName: undefined,
      hiringManager: undefined,
      whyThisCompany: undefined,
    }),
});

export type CoverLetterRequest = z.input<typeof coverLetterRequestSchema>;
export type ParsedCoverLetterRequest = z.output<typeof coverLetterRequestSchema>;
export interface CoverLetterOptions {
  tone: CoverLetterTone;
  length: CoverLetterLength;
  companyName?: string;
  hiringManager?: string;
  whyThisCompany?: string;
}

export const rewriteRequestSchema = z.object({
  kind: z.enum(REWRITE_KINDS),
  resumeText: z.string().min(MIN_RESUME_CHARS).max(MAX_RESUME_CHARS),
  jobDescription: z
    .string()
    .max(MAX_JOB_DESCRIPTION_CHARS)
    .optional()
    .nullable()
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  analysisSummary: optionalText(MAX_ANALYSIS_SUMMARY_CHARS),
});

export type RewriteRequest = z.input<typeof rewriteRequestSchema>;
export type ParsedRewriteRequest = z.output<typeof rewriteRequestSchema>;

/* ------------------------------------------------------------------ */
/* Responses (what the routes send to the browser)                    */
/* ------------------------------------------------------------------ */

export interface GroundedClaim {
  claim: string;
  resumeQuote: string;
}

export type GroundingNote =
  | { kind: "unsupported-claim"; claim: string; resumeQuote: string; removedSentence: boolean }
  | { kind: "unsupported-number"; value: string; paragraph: number }
  | { kind: "missing-why-company" };

export interface CoverLetterResponse {
  paragraphs: string[];
  /** Claims whose quote was found in the resume. */
  claimsUsed: GroundedClaim[];
  notes: GroundingNote[];
}

export interface VariantCheck {
  /** Numbers in the variant that do not appear anywhere in the resume. */
  unsupportedNumbers: string[];
  /** Quotes the model cited that could not be found in the resume. */
  unsupportedQuotes: string[];
  /** True when either list is non-empty: the UI shows a warning. */
  flagged: boolean;
}

export interface RewriteResponse {
  kind: RewriteKind;
  variants: string[];
  rationale: string;
  checks: VariantCheck[];
}

/* ------------------------------------------------------------------ */
/* Gemini structured-output schemas (OpenAPI subset)                  */
/* ------------------------------------------------------------------ */

const str = (description: string) => ({ type: "STRING", description });

export const geminiCoverLetterSchema = {
  type: "OBJECT",
  properties: {
    paragraphs: {
      type: "ARRAY",
      description:
        "The letter body as 3 to 5 paragraphs, greeting first and sign-off last. Plain text, no markdown.",
      items: { type: "STRING" },
    },
    claimsUsed: {
      type: "ARRAY",
      description:
        "Every factual claim about the candidate made in the letter, each with the resume text it comes from.",
      items: {
        type: "OBJECT",
        properties: {
          claim: str("The claim as it is worded in the letter."),
          resumeQuote: str("Text copied verbatim from the resume that supports the claim."),
        },
        required: ["claim", "resumeQuote"],
      },
    },
  },
  required: ["paragraphs", "claimsUsed"],
} as const;

export const geminiRewriteSchema = {
  type: "OBJECT",
  properties: {
    variants: {
      type: "ARRAY",
      description: "Exactly three distinct variants.",
      items: {
        type: "OBJECT",
        properties: {
          text: str("The variant text. Plain text, no markdown."),
          resumeQuotes: {
            type: "ARRAY",
            description: "Resume text, copied verbatim, that this variant draws on.",
            items: { type: "STRING" },
          },
        },
        required: ["text", "resumeQuotes"],
      },
    },
    rationale: str("Two or three sentences on how the variants differ and what each emphasises."),
  },
  required: ["variants", "rationale"],
} as const;

/* ------------------------------------------------------------------ */
/* Lenient parsing of model output                                     */
/* ------------------------------------------------------------------ */

const MAX_PARAGRAPHS = 6;
const MAX_PARAGRAPH_CHARS = 1_600;
const MAX_CLAIMS = 20;
const MAX_CLAIM_CHARS = 400;
const MAX_QUOTE_CHARS = 600;

export const REWRITE_MAX_CHARS: Record<RewriteKind, number> = {
  summary: 900,
  // LinkedIn's own limit.
  "linkedin-headline": 220,
  "linkedin-about": 2_600,
};

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Parse Gemini's text as JSON, tolerating a ```json fence. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export interface RawCoverLetter {
  paragraphs: string[];
  claimsUsed: GroundedClaim[];
}

/** Coerce model output into shape, truncating rather than rejecting. Null if unusable. */
export function normalizeCoverLetter(raw: unknown): RawCoverLetter | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const paragraphs = asArray(record.paragraphs)
    .map((p) => asString(p, MAX_PARAGRAPH_CHARS))
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS);
  if (paragraphs.length === 0) return null;

  const claimsUsed = asArray(record.claimsUsed)
    .map((item) => {
      const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        claim: asString(c.claim, MAX_CLAIM_CHARS),
        resumeQuote: asString(c.resumeQuote, MAX_QUOTE_CHARS),
      };
    })
    .filter((c) => c.claim)
    .slice(0, MAX_CLAIMS);

  return { paragraphs, claimsUsed };
}

export interface RawRewrite {
  variants: { text: string; resumeQuotes: string[] }[];
  rationale: string;
}

export function normalizeRewrite(raw: unknown, kind: RewriteKind): RawRewrite | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const max = REWRITE_MAX_CHARS[kind];
  const seen = new Set<string>();
  const variants = asArray(record.variants)
    .map((item) => {
      // Accept a bare string too: a model that ignores the nested shape still
      // produced something usable.
      if (typeof item === "string") return { text: asString(item, max), resumeQuotes: [] };
      const v = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        text: asString(v.text, max),
        resumeQuotes: asArray(v.resumeQuotes)
          .map((q) => asString(q, MAX_QUOTE_CHARS))
          .filter(Boolean)
          .slice(0, 8),
      };
    })
    .filter((v) => {
      const key = v.text.toLowerCase();
      if (!v.text || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  if (variants.length === 0) return null;
  return { variants, rationale: asString(record.rationale, 800) };
}

/* ------------------------------------------------------------------ */
/* Grounding                                                           */
/* ------------------------------------------------------------------ */

/** Lowercased word tokens; punctuation and bullet glyphs are dropped. */
export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]+(?:[.+#][a-z0-9]+)*[+#]*/g) ?? []
  );
}

/**
 * Best overlap between the quote's tokens and any window of the source of the
 * same length (plus a little slack for inserted words). 1 means every token of
 * the quote appears, close together, in the source.
 */
export function quoteOverlap(quote: string, source: string): number {
  const q = tokenize(quote);
  if (q.length === 0) return 0;
  const s = tokenize(source);
  if (s.length === 0) return 0;

  const normalizedQuote = q.join(" ");
  if (` ${s.join(" ")} `.includes(` ${normalizedQuote} `)) return 1;

  const need = new Map<string, number>();
  for (const t of q) need.set(t, (need.get(t) ?? 0) + 1);

  const windowSize = Math.min(s.length, q.length + Math.max(2, Math.ceil(q.length * 0.25)));
  const have = new Map<string, number>();
  let matched = 0;
  const add = (t: string) => {
    const n = (have.get(t) ?? 0) + 1;
    have.set(t, n);
    if (n <= (need.get(t) ?? 0)) matched += 1;
  };
  const drop = (t: string) => {
    const n = have.get(t) ?? 0;
    if (n <= (need.get(t) ?? 0)) matched -= 1;
    have.set(t, n - 1);
  };

  let best = 0;
  for (let i = 0; i < s.length; i += 1) {
    add(s[i]);
    if (i >= windowSize) drop(s[i - windowSize]);
    if (matched > best) best = matched;
    if (best === q.length) break;
  }
  return best / q.length;
}

export const QUOTE_OVERLAP_THRESHOLD = 0.8;

export function isQuoteSupported(
  quote: string,
  source: string,
  threshold = QUOTE_OVERLAP_THRESHOLD,
): boolean {
  // Very short "quotes" (one or two words) prove nothing on their own.
  if (tokenize(quote).length < 2) return false;
  return quoteOverlap(quote, source) >= threshold;
}

/**
 * Numbers as written: 30%, $1.2M, 5+, 2019, 10,000. Normalised to their
 * digits so "10,000" in the output matches "10000" in the resume.
 */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/,/g, "").replace(/\.0+$/, "")))];
}

/** Numbers in `text` that appear in none of the `sources`. */
export function unsupportedNumbers(text: string, ...sources: (string | undefined | null)[]): string[] {
  const allowed = new Set(sources.flatMap((s) => (s ? extractNumbers(s) : [])));
  return extractNumbers(text).filter((n) => !allowed.has(n));
}

function splitSentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [paragraph];
}

/**
 * Check a generated letter against the resume.
 *
 * - A claim whose quote is not in the resume is dropped from `claimsUsed`, and
 *   the sentence that carries it is removed from the letter when it can be
 *   found (≥ 0.8 token overlap). Otherwise it is only flagged.
 * - Any number in the letter that is not in the resume or the user's own
 *   inputs is flagged with the paragraph it sits in.
 */
export function groundCoverLetter(
  letter: RawCoverLetter,
  resumeText: string,
  userSuppliedText = "",
): CoverLetterResponse {
  const notes: GroundingNote[] = [];
  const claimsUsed: GroundedClaim[] = [];
  let paragraphs = [...letter.paragraphs];

  for (const claim of letter.claimsUsed) {
    if (claim.resumeQuote && isQuoteSupported(claim.resumeQuote, resumeText)) {
      claimsUsed.push(claim);
      continue;
    }
    let removedSentence = false;
    paragraphs = paragraphs.map((paragraph) => {
      const sentences = splitSentences(paragraph);
      const kept = sentences.filter((sentence) => {
        const hit =
          tokenize(claim.claim).length >= 3 &&
          quoteOverlap(claim.claim, sentence) >= QUOTE_OVERLAP_THRESHOLD;
        // Never empty a paragraph entirely; the greeting and sign-off matter.
        if (hit && sentences.length > 1) {
          removedSentence = true;
          return false;
        }
        return true;
      });
      return kept.join("").trim();
    });
    notes.push({
      kind: "unsupported-claim",
      claim: claim.claim,
      resumeQuote: claim.resumeQuote,
      removedSentence,
    });
  }

  paragraphs = paragraphs.filter(Boolean);
  paragraphs.forEach((paragraph, index) => {
    for (const value of unsupportedNumbers(paragraph, resumeText, userSuppliedText)) {
      notes.push({ kind: "unsupported-number", value, paragraph: index });
    }
  });

  return { paragraphs, claimsUsed, notes };
}

export function groundRewrite(raw: RawRewrite, kind: RewriteKind, resumeText: string): RewriteResponse {
  const checks = raw.variants.map<VariantCheck>((variant) => {
    const numbers = unsupportedNumbers(variant.text, resumeText);
    const quotes = variant.resumeQuotes.filter((q) => !isQuoteSupported(q, resumeText));
    return {
      unsupportedNumbers: numbers,
      unsupportedQuotes: quotes,
      flagged: numbers.length > 0 || quotes.length > 0,
    };
  });
  return {
    kind,
    variants: raw.variants.map((v) => v.text),
    rationale: raw.rationale,
    checks,
  };
}

/* ------------------------------------------------------------------ */
/* Analysis summary (client builds this from the session's analysis)  */
/* ------------------------------------------------------------------ */

function names(list: unknown, key: string, limit: number): string[] {
  return asArray(list)
    .map((item) =>
      item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined,
    )
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, limit);
}

/**
 * A compact, loosely-typed digest of an analysis object for the prompt. Takes
 * `unknown` so it keeps working if the analysis shape grows new fields.
 */
export function summarizeAnalysis(analysis: unknown): string | undefined {
  if (!analysis || typeof analysis !== "object") return undefined;
  const a = analysis as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof a.roleTitle === "string" && a.roleTitle) lines.push(`Role: ${a.roleTitle}`);
  if (typeof a.overallScore === "number") lines.push(`Match score: ${Math.round(a.overallScore)}/100`);
  const matched = names(a.matchedSkills, "skill", 12);
  if (matched.length) lines.push(`Evidenced skills: ${matched.join(", ")}`);
  const missing = names(a.missingSkills, "skill", 12);
  if (missing.length) lines.push(`Not evidenced (do not claim): ${missing.join(", ")}`);
  const summary = lines.join("\n").slice(0, MAX_ANALYSIS_SUMMARY_CHARS);
  return summary || undefined;
}
