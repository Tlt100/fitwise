import type { MatchResult } from "@/lib/match/keywords";
import type { CompositeScore } from "@/lib/match/score";
import type { VerificationReport } from "@/lib/ai/verify";
import { z } from "zod";

/**
 * The shape of an analysis. This file is the single source of truth: the Zod
 * schema validates whatever the model returns, and `geminiAnalysisSchema` below
 * is the same contract expressed in the OpenAPI subset Gemini accepts for
 * structured output. Both read their bounds from `LIMITS`, so they cannot
 * drift apart.
 *
 * Validation is deliberately forgiving about size and strict about meaning:
 * an overlong string is truncated, an overlong list is cut, an out-of-range
 * number is clamped, and a single malformed list item is dropped -- none of
 * those should cost the user the whole analysis. A missing section, or an
 * analysis without its four dimensions, is still a failure (and the route
 * retries once).
 *
 * The model does not produce the score the UI shows. That is computed in code
 * (src/lib/match/score.ts) from the deterministic keyword match and the
 * per-requirement statuses below. `overallScore` survives only as an optional
 * field so analyses stored by older builds still parse.
 */

export const evidenceStrength = z.enum(["strong", "moderate"]);
export const importance = z.enum(["critical", "important", "nice-to-have"]);
export const requirementStatus = z.enum(["met", "partial", "not-evident"]);
export const priority = z.enum(["high", "medium", "low"]);
export const effort = z.enum(["quick", "moderate", "substantial"]);

/** The four dimensions, in display order. */
export const DIMENSION_NAMES = ["Skills", "Experience", "Education & credentials", "Keywords"] as const;

/** Size bounds shared by the Zod schema and the Gemini response schema. */
export const LIMITS = {
  roleTitle: 160,
  scoreLabel: 60,
  scoreRationale: 1200,
  dimensions: { min: 4, max: 4, name: 60, summary: 600 },
  matchedSkills: { max: 20, skill: 80, evidence: 600 },
  missingSkills: { max: 20, skill: 80, note: 600, closestExperience: 400 },
  experienceAlignment: { min: 1, max: 15, requirement: 300, explanation: 800 },
  resumeSuggestions: { max: 12, area: 80, title: 160, detail: 900 },
  bulletRewrites: { max: 10, section: 120, original: 600, suggested: 600, rationale: 600 },
  keywords: { max: 25, keyword: 60, guidance: 400 },
  interviewTopics: { max: 8, topic: 120, why: 500, questions: 4, question: 300 },
  actionPlan: { min: 1, max: 8, step: 240, why: 500 },
} as const;

/* ------------------------------------------------------------------------ */
/* Lenient building blocks                                                   */
/* ------------------------------------------------------------------------ */

/** A string, trimmed and truncated to `max` characters rather than rejected. */
const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : v), z.string());

/** A 0-100 number, rounded and clamped rather than rejected. */
const score0to100 = z.preprocess((v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : n;
}, z.number().min(0).max(100));

/**
 * A list whose malformed items are dropped and whose surplus is cut, so one
 * bad entry costs that entry, not the analysis. Still rejects a non-array.
 */
function list<T extends z.ZodType>(item: T, max: number, min = 0) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => item.safeParse(x).success).slice(0, max) : v),
    z.array(item).min(min).max(max),
  );
}

/** An enum that falls back to `fallback` when the value is missing or unknown. */
function enumWithDefault<T extends z.ZodEnum>(schema: T, fallback: z.infer<T>) {
  return z.preprocess((v) => (schema.safeParse(v).success ? v : fallback), schema);
}

/* ------------------------------------------------------------------------ */
/* Zod schema                                                                */
/* ------------------------------------------------------------------------ */

const L = LIMITS;

const dimensionItem = z.object({
  name: text(L.dimensions.name),
  score: score0to100,
  summary: text(L.dimensions.summary),
});

const matchedSkillItem = z.object({
  skill: text(L.matchedSkills.skill),
  strength: evidenceStrength,
  // Must be traceable to the resume: this is quoted back in the UI.
  evidence: text(L.matchedSkills.evidence),
  /** Set in code by verifyAnalysis: the evidence was found in the resume. */
  verified: z.boolean().optional(),
});

const missingSkillItem = z.object({
  skill: text(L.missingSkills.skill),
  importance,
  note: text(L.missingSkills.note),
  closestExperience: text(L.missingSkills.closestExperience),
});

const alignmentItem = z.object({
  requirement: text(L.experienceAlignment.requirement),
  status: requirementStatus,
  // Older analyses (and a model that forgets) get the middle weight.
  importance: enumWithDefault(importance, "important"),
  explanation: text(L.experienceAlignment.explanation),
});

const suggestionItem = z.object({
  area: text(L.resumeSuggestions.area),
  title: text(L.resumeSuggestions.title),
  detail: text(L.resumeSuggestions.detail),
  priority: enumWithDefault(priority, "medium"),
});

const rewriteItem = z.object({
  section: text(L.bulletRewrites.section),
  original: text(L.bulletRewrites.original),
  suggested: text(L.bulletRewrites.suggested),
  rationale: text(L.bulletRewrites.rationale),
  /** Set in code: the rewrite contains figures the original does not. */
  addsUnverifiedNumbers: z.boolean().optional(),
  /** Set in code: the figures in question, as written in the rewrite. */
  unverifiedNumbers: z.array(z.string()).optional(),
});

const keywordItem = z.object({
  keyword: text(L.keywords.keyword),
  presentInResume: z.boolean(),
  guidance: text(L.keywords.guidance),
});

const interviewItem = z.object({
  topic: text(L.interviewTopics.topic),
  why: text(L.interviewTopics.why),
  questions: list(text(L.interviewTopics.question), L.interviewTopics.questions),
});

const actionItem = z.object({
  step: text(L.actionPlan.step),
  why: text(L.actionPlan.why),
  effort: enumWithDefault(effort, "moderate"),
});

export const analysisSchema = z.object({
  roleTitle: text(L.roleTitle),
  /** Legacy: no longer requested from the model and never shown as the score. */
  overallScore: score0to100.optional(),
  /** Legacy: the label shown comes from the composite score. */
  scoreLabel: text(L.scoreLabel).optional(),
  /** The model's overall read, in words. Explains; does not score. */
  scoreRationale: text(L.scoreRationale),

  dimensions: list(dimensionItem, L.dimensions.max, L.dimensions.min),
  matchedSkills: list(matchedSkillItem, L.matchedSkills.max),
  missingSkills: list(missingSkillItem, L.missingSkills.max),
  experienceAlignment: list(alignmentItem, L.experienceAlignment.max),
  resumeSuggestions: list(suggestionItem, L.resumeSuggestions.max),
  bulletRewrites: list(rewriteItem, L.bulletRewrites.max),
  keywords: list(keywordItem, L.keywords.max),
  interviewTopics: list(interviewItem, L.interviewTopics.max),
  actionPlan: list(actionItem, L.actionPlan.max),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type Dimension = Analysis["dimensions"][number];
export type MatchedSkill = Analysis["matchedSkills"][number];
export type MissingSkill = Analysis["missingSkills"][number];
export type AlignmentItem = Analysis["experienceAlignment"][number];
export type BulletRewrite = Analysis["bulletRewrites"][number];

/**
 * What POST /api/analyze returns on success.
 *
 * - `analysis`: the model's analysis after validation and grounding checks
 *   (evidence carries `verified`, rewrites whose `original` is not in the
 *   resume are removed, rewrites that add figures carry
 *   `addsUnverifiedNumbers`).
 * - `match`: the deterministic keyword match of resume against posting.
 * - `score`: the composite score computed in code from `match` and
 *   `analysis.experienceAlignment` (plus `atsReadiness` when the request sent
 *   one). This is the only score the UI should display.
 * - `verification`: counts from the grounding checks.
 */
export interface AnalyzeResponse {
  analysis: Analysis;
  match: MatchResult;
  score: CompositeScore;
  verification: VerificationReport;
  generatedAt: string;
}

/* ------------------------------------------------------------------------ */
/* Gemini response schema                                                    */
/* ------------------------------------------------------------------------ */

// Length and item limits are stated in the descriptions, not as schema
// keywords: Gemini rejects a schema with this many maxLength/maxItems
// constraints as "too many states" (HTTP 400). The Zod contract above
// trims anything that runs over, so the limits still hold.
const str = (description: string, maxLength?: number) => ({
  type: "STRING",
  description: maxLength ? `${description} At most ${maxLength} characters.` : description,
});
const enumOf = (values: readonly string[], description: string) => ({
  type: "STRING",
  enum: [...values],
  description,
});
const arrayOf = <T,>(
  items: T,
  description: string,
  bounds: { min?: number; max: number },
) => ({
  type: "ARRAY",
  description: bounds.min
    ? `${description} Between ${bounds.min} and ${bounds.max} items.`
    : `${description} At most ${bounds.max} items.`,
  items,
});

/** Gemini `responseSchema` — OpenAPI 3.0 subset, so no $schema and no unions. */
export const geminiAnalysisSchema = {
  type: "OBJECT",
  properties: {
    roleTitle: str("The job title from the posting, verbatim if stated.", L.roleTitle),
    scoreRationale: str(
      "Two to four sentences on how well the resume evidences this posting and what drives that. Do not give a number or a percentage: the score is computed separately.",
      L.scoreRationale,
    ),
    dimensions: arrayOf(
      {
        type: "OBJECT",
        properties: {
          name: enumOf(DIMENSION_NAMES, "Dimension name."),
          score: {
            type: "INTEGER",
            minimum: 0,
            maximum: 100,
            description: "0-100 for this dimension.",
          },
          summary: str("One or two sentences on this dimension.", L.dimensions.summary),
        },
        required: ["name", "score", "summary"],
      },
      "Exactly four entries, one per name: Skills, Experience, Education & credentials, Keywords.",
      { min: L.dimensions.min, max: L.dimensions.max },
    ),
    matchedSkills: arrayOf(
      {
        type: "OBJECT",
        properties: {
          skill: str("The skill or requirement.", L.matchedSkills.skill),
          strength: enumOf(
            ["strong", "moderate"],
            "strong when the resume shows it applied in context; moderate when it is only listed or implied.",
          ),
          evidence: str(
            "Copy the resume line that supports this, word for word. It is checked against the resume and marked as a paraphrase if it does not match. Never invent evidence.",
            L.matchedSkills.evidence,
          ),
        },
        required: ["skill", "strength", "evidence"],
      },
      "Requirements the resume genuinely evidences.",
      { max: L.matchedSkills.max },
    ),
    missingSkills: arrayOf(
      {
        type: "OBJECT",
        properties: {
          skill: str("The requirement that is not evidenced.", L.missingSkills.skill),
          importance: enumOf(
            ["critical", "important", "nice-to-have"],
            "How central the posting makes this requirement.",
          ),
          note: str("Why it matters for this role and what would count as evidence.", L.missingSkills.note),
          closestExperience: str(
            "The nearest genuinely related thing on the resume, or the exact string 'No related experience found' when there is none. Do not stretch.",
            L.missingSkills.closestExperience,
          ),
        },
        required: ["skill", "importance", "note", "closestExperience"],
      },
      "Requirements in the posting with no clear support in the resume. These are gaps to develop or evidence, never things to claim.",
      { max: L.missingSkills.max },
    ),
    experienceAlignment: arrayOf(
      {
        type: "OBJECT",
        properties: {
          requirement: str("The stated requirement, e.g. '5+ years backend'.", L.experienceAlignment.requirement),
          status: enumOf(
            ["met", "partial", "not-evident"],
            "met, partial, or not-evident based only on what the resume shows.",
          ),
          importance: enumOf(
            ["critical", "important", "nice-to-have"],
            "critical for must-haves and core duties; important for other stated requirements; nice-to-have for anything marked preferred, bonus or a plus.",
          ),
          explanation: str("What in the resume supports this judgement.", L.experienceAlignment.explanation),
        },
        required: ["requirement", "status", "importance", "explanation"],
      },
      "One entry per distinct stated requirement of the posting (skills, experience, seniority, qualifications), most important first. These statuses feed the score directly, so judge each one conservatively.",
      { min: L.experienceAlignment.min, max: L.experienceAlignment.max },
    ),
    resumeSuggestions: arrayOf(
      {
        type: "OBJECT",
        properties: {
          area: str("Which part of the resume, e.g. 'Summary', 'Projects'.", L.resumeSuggestions.area),
          title: str("The suggestion in one line.", L.resumeSuggestions.title),
          detail: str("How to carry it out, referring to their actual content.", L.resumeSuggestions.detail),
          priority: enumOf(["high", "medium", "low"], "Impact on this application."),
        },
        required: ["area", "title", "detail", "priority"],
      },
      "Changes to the document itself: structure, emphasis, clarity.",
      { max: L.resumeSuggestions.max },
    ),
    bulletRewrites: arrayOf(
      {
        type: "OBJECT",
        properties: {
          section: str("Where this bullet lives, e.g. 'Experience - Acme Corp'.", L.bulletRewrites.section),
          original: str(
            "The bullet exactly as it appears in the resume. Rewrites whose original cannot be found in the resume are discarded.",
            L.bulletRewrites.original,
          ),
          suggested: str(
            "The rewrite. No invented metrics, tools, scope or outcomes. If the original lacks a number, do not add one; ask for it in the rationale instead.",
            L.bulletRewrites.suggested,
          ),
          rationale: str("Why this reads better for this posting.", L.bulletRewrites.rationale),
        },
        required: ["section", "original", "suggested", "rationale"],
      },
      "Rewrites of existing bullet points. `original` MUST be copied verbatim from the resume. The rewrite may only reorganise, sharpen or surface what is already there.",
      { max: L.bulletRewrites.max },
    ),
    keywords: arrayOf(
      {
        type: "OBJECT",
        properties: {
          keyword: str("The term.", L.keywords.keyword),
          presentInResume: {
            type: "BOOLEAN",
            description: "True only if the resume already uses it. Must agree with keyword_facts.",
          },
          guidance: str(
            "Where it could truthfully go, or 'Only use if you have done this' when it is not supported.",
            L.keywords.guidance,
          ),
        },
        required: ["keyword", "presentInResume", "guidance"],
      },
      "Terms from the posting worth using, each flagged by whether the resume already contains it. Prefer the terms listed in keyword_facts.",
      { max: L.keywords.max },
    ),
    interviewTopics: arrayOf(
      {
        type: "OBJECT",
        properties: {
          topic: str("The topic.", L.interviewTopics.topic),
          why: str("Why this is likely to come up for this pairing.", L.interviewTopics.why),
          questions: arrayOf(
            str("A question.", L.interviewTopics.question),
            "Up to four questions they should be ready for.",
            { max: L.interviewTopics.questions },
          ),
        },
        required: ["topic", "why", "questions"],
      },
      "What to prepare, drawn from the overlap and the gaps.",
      { max: L.interviewTopics.max },
    ),
    actionPlan: arrayOf(
      {
        type: "OBJECT",
        properties: {
          step: str("What to do, concretely.", L.actionPlan.step),
          why: str("The difference it makes.", L.actionPlan.why),
          effort: enumOf(
            ["quick", "moderate", "substantial"],
            "quick is under ten minutes; substantial means learning or building something new.",
          ),
        },
        required: ["step", "why", "effort"],
      },
      "Three to six steps, ordered by how much they would change this application.",
      { min: L.actionPlan.min, max: L.actionPlan.max },
    ),
  },
  required: [
    "roleTitle",
    "scoreRationale",
    "dimensions",
    "matchedSkills",
    "missingSkills",
    "experienceAlignment",
    "resumeSuggestions",
    "bulletRewrites",
    "keywords",
    "interviewTopics",
    "actionPlan",
  ],
} as const;
