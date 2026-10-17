/**
 * The composite match score, computed in code from parts that can each be
 * checked by hand. The model never supplies a number that goes into it: the
 * model's only input is a per-requirement status (met / partial /
 * not-evident) and importance, and the arithmetic below turns those into a
 * score.
 *
 *   composite = round( sum(weight_i * score_i) / sum(weight_i) )
 *
 * over the components that are available:
 *
 *   keywords      weight 0.40  weighted keyword coverage from the deterministic
 *                              engine (exact = 1, variant = 0.8, missing = 0)
 *   requirements  weight 0.45  sum(importance * credit) / sum(importance) * 100,
 *                              importance critical 3 / important 2 /
 *                              nice-to-have 1, credit met 1 / partial 0.5 /
 *                              not-evident 0
 *   ats           weight 0.15  ATS-readiness 0-100, when supplied
 *
 * A missing component is left out and the remaining weights are renormalised,
 * so a resume is never penalised for a check that did not run.
 *
 * It is an evidence score: how much of what the posting asks for is visibly
 * supported by the document. It is not, and must never be described as, a
 * likelihood of being hired.
 */

export type ScoreComponentId = "keywords" | "requirements" | "ats";
export type RequirementStatus = "met" | "partial" | "not-evident";
export type RequirementImportance = "critical" | "important" | "nice-to-have";

export const SCORE_WEIGHTS: Record<ScoreComponentId, number> = {
  keywords: 0.4,
  requirements: 0.45,
  ats: 0.15,
};

export const REQUIREMENT_STATUS_CREDIT: Record<RequirementStatus, number> = {
  met: 1,
  partial: 0.5,
  "not-evident": 0,
};

export const IMPORTANCE_WEIGHT: Record<RequirementImportance, number> = {
  critical: 3,
  important: 2,
  "nice-to-have": 1,
};

export const SCORE_FORMULA =
  "Composite = 40% keyword coverage + 45% requirement evidence + 15% ATS readiness. " +
  "Keyword coverage weights each posting term by where and how often it appears (exact match 1, variant 0.8, missing 0). " +
  "Requirement evidence weights each requirement by importance (critical 3, important 2, nice-to-have 1) and credits met 1, partial 0.5, not evident 0. " +
  "Any part that could not be measured is left out and the other weights are scaled up to fill its share.";

export interface ScoreComponent {
  id: ScoreComponentId;
  label: string;
  /** 0-100, or null when this component could not be measured. */
  score: number | null;
  /** Nominal weight from SCORE_WEIGHTS. */
  weight: number;
  /** Share of the composite this component actually carried (0 when absent). */
  effectiveWeight: number;
  /** One sentence on how this number was produced. */
  detail: string;
}

export interface CompositeScore {
  /** 0-100, or null when no component could be measured. */
  composite: number | null;
  label: string;
  components: ScoreComponent[];
  formula: string;
}

export interface RequirementInput {
  status: RequirementStatus;
  importance?: RequirementImportance;
}

/** Requirement evidence as a 0-100 number, or null with no requirements. */
export function requirementEvidenceScore(items: readonly RequirementInput[]): number | null {
  let total = 0;
  let earned = 0;
  for (const item of items) {
    const weight = IMPORTANCE_WEIGHT[item.importance ?? "important"] ?? IMPORTANCE_WEIGHT.important;
    const credit = REQUIREMENT_STATUS_CREDIT[item.status] ?? 0;
    total += weight;
    earned += weight * credit;
  }
  return total > 0 ? Math.round((earned / total) * 100) : null;
}

/** Plain words for a composite score. Describes evidence, never odds. */
export function scoreLabel(score: number | null): string {
  if (score === null) return "Not enough to score";
  if (score >= 80) return "Strong alignment";
  if (score >= 65) return "Good alignment";
  if (score >= 50) return "Partial alignment";
  if (score >= 35) return "Limited alignment";
  return "Low alignment";
}

function clampScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

export interface ComposeInput {
  /** From MatchResult.coverage.weightedCoveragePct. */
  keywordCoveragePct: number | null | undefined;
  /** From the analysis' experienceAlignment items. */
  requirements: readonly RequirementInput[];
  /** ATS readiness 0-100, when an ATS check ran. */
  atsReadiness?: number | null;
}

export function composeScore({ keywordCoveragePct, requirements, atsReadiness }: ComposeInput): CompositeScore {
  const keyword = clampScore(keywordCoveragePct);
  const requirement = clampScore(requirementEvidenceScore(requirements));
  const ats = clampScore(atsReadiness);

  const raw: Omit<ScoreComponent, "effectiveWeight">[] = [
    {
      id: "keywords",
      label: "Keyword coverage",
      score: keyword,
      weight: SCORE_WEIGHTS.keywords,
      detail:
        keyword === null
          ? "No recognisable skills or tools were found in the posting, so keyword coverage was not measured."
          : "Share of the posting's weighted terms that appear in your resume, counted in code (exact 1, variant 0.8).",
    },
    {
      id: "requirements",
      label: "Requirement evidence",
      score: requirement,
      weight: SCORE_WEIGHTS.requirements,
      detail:
        requirement === null
          ? "No requirements were assessed, so requirement evidence was not measured."
          : `${requirements.length} stated requirement${requirements.length === 1 ? "" : "s"} judged met, partial or not evident, weighted by importance.`,
    },
    {
      id: "ats",
      label: "ATS readiness",
      score: ats,
      weight: SCORE_WEIGHTS.ats,
      detail:
        ats === null
          ? "The ATS formatting check has not run, so it is left out."
          : "How cleanly the document parses: structure, headings and formatting.",
    },
  ];

  const present = raw.filter((c) => c.score !== null);
  const presentWeight = present.reduce((sum, c) => sum + c.weight, 0);
  const components: ScoreComponent[] = raw.map((c) => ({
    ...c,
    effectiveWeight:
      c.score === null || presentWeight === 0
        ? 0
        : Math.round((c.weight / presentWeight) * 1000) / 1000,
  }));

  const composite =
    presentWeight === 0
      ? null
      : Math.round(
          present.reduce((sum, c) => sum + c.weight * (c.score as number), 0) / presentWeight,
        );

  return { composite, label: scoreLabel(composite), components, formula: SCORE_FORMULA };
}
