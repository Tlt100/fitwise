import { describe, expect, it } from "vitest";
import { analysisSchema, DIMENSION_NAMES, geminiAnalysisSchema, LIMITS } from "./analysis-schema";

/** A minimal object that satisfies the contract, used as a base for mutation. */
const valid = {
  roleTitle: "Backend Engineer",
  scoreRationale: "Most core requirements are evidenced.",
  dimensions: DIMENSION_NAMES.map((name) => ({ name, score: 70, summary: "Fine." })),
  matchedSkills: [{ skill: "Go", strength: "strong", evidence: "Built a service in Go" }],
  missingSkills: [
    {
      skill: "Kubernetes",
      importance: "critical",
      note: "Named as the deployment target.",
      closestExperience: "No related experience found",
    },
  ],
  experienceAlignment: [
    { requirement: "5+ years", status: "partial", importance: "critical", explanation: "About four years." },
  ],
  resumeSuggestions: [
    { area: "Summary", title: "Lead with payments", detail: "Move it up.", priority: "high" },
  ],
  bulletRewrites: [
    { section: "Experience", original: "Did a thing", suggested: "Did the thing", rationale: "Clearer." },
  ],
  keywords: [{ keyword: "Go", presentInResume: true, guidance: "Already used." }],
  interviewTopics: [{ topic: "Reconciliation", why: "Closest match.", questions: ["How?"] }],
  actionPlan: [{ step: "Rewrite the summary", why: "Biggest gain.", effort: "quick" }],
};

describe("analysisSchema", () => {
  it("accepts a well-formed analysis without a model score", () => {
    const parsed = analysisSchema.parse(valid);
    expect(parsed.roleTitle).toBe("Backend Engineer");
    expect(parsed.overallScore).toBeUndefined();
    expect(parsed.experienceAlignment[0].importance).toBe("critical");
  });

  it("still accepts a legacy overallScore, clamped", () => {
    expect(analysisSchema.parse({ ...valid, overallScore: 140 }).overallScore).toBe(100);
    expect(analysisSchema.parse({ ...valid, overallScore: 72.6 }).overallScore).toBe(73);
  });

  it("truncates an overlong string instead of failing", () => {
    const long = "x".repeat(5000);
    const parsed = analysisSchema.parse({ ...valid, scoreRationale: long, roleTitle: long });
    expect(parsed.scoreRationale).toHaveLength(LIMITS.scoreRationale);
    expect(parsed.roleTitle).toHaveLength(LIMITS.roleTitle);
  });

  it("cuts an overlong list instead of failing", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...valid.keywords[0], keyword: `k${i}` }));
    expect(analysisSchema.parse({ ...valid, keywords: many }).keywords).toHaveLength(LIMITS.keywords.max);
  });

  it("clamps dimension scores", () => {
    const dims = valid.dimensions.map((d) => ({ ...d, score: -10 }));
    expect(analysisSchema.parse({ ...valid, dimensions: dims }).dimensions[0].score).toBe(0);
  });

  it("drops an item with an unknown evidence strength but keeps the rest", () => {
    const bad = {
      ...valid,
      matchedSkills: [{ ...valid.matchedSkills[0], strength: "definite" }, valid.matchedSkills[0]],
    };
    expect(analysisSchema.parse(bad).matchedSkills).toHaveLength(1);
  });

  it("drops a requirement with an unknown status, since it would skew the score", () => {
    const bad = {
      ...valid,
      experienceAlignment: [{ ...valid.experienceAlignment[0], status: "maybe" }],
    };
    expect(analysisSchema.parse(bad).experienceAlignment).toEqual([]);
  });

  it("defaults a missing or unknown importance to important", () => {
    const base = valid.experienceAlignment[0];
    const noImportance = { requirement: base.requirement, status: base.status, explanation: base.explanation };
    const parsed = analysisSchema.parse({
      ...valid,
      experienceAlignment: [noImportance, { ...noImportance, importance: "vital" }],
    });
    expect(parsed.experienceAlignment.map((e) => e.importance)).toEqual(["important", "important"]);
  });

  it("requires exactly four dimensions", () => {
    expect(() => analysisSchema.parse({ ...valid, dimensions: valid.dimensions.slice(0, 3) })).toThrow();
    const five = [...valid.dimensions, { name: "Extra", score: 1, summary: "" }];
    expect(analysisSchema.parse({ ...valid, dimensions: five }).dimensions).toHaveLength(4);
  });

  it("requires every top-level section, even when empty", () => {
    const withoutPlan: Record<string, unknown> = { ...valid };
    delete withoutPlan.actionPlan;
    expect(() => analysisSchema.parse(withoutPlan)).toThrow();
  });

  it("accepts empty arrays, since a section can legitimately have no findings", () => {
    const empty = { ...valid, bulletRewrites: [], missingSkills: [] };
    expect(analysisSchema.parse(empty).bulletRewrites).toEqual([]);
  });

  it("drops a keyword whose flag is not a boolean", () => {
    const bad = { ...valid, keywords: [{ ...valid.keywords[0], presentInResume: "yes" }] };
    expect(analysisSchema.parse(bad).keywords).toEqual([]);
  });

  it("rejects a section that is not a list at all", () => {
    expect(() => analysisSchema.parse({ ...valid, keywords: "Go, Rust" })).toThrow();
  });
});

describe("geminiAnalysisSchema", () => {
  it("asks for every required Zod field and no legacy ones", () => {
    const shape = analysisSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const requiredZodKeys = Object.keys(shape)
      .filter((key) => !shape[key].safeParse(undefined).success)
      .sort();
    expect([...geminiAnalysisSchema.required].sort()).toEqual(requiredZodKeys);
    expect(Object.keys(geminiAnalysisSchema.properties).sort()).toEqual(requiredZodKeys);
    expect(Object.keys(geminiAnalysisSchema.properties)).not.toContain("overallScore");
  });

  it("states the Zod limits in descriptions, not as constraint keywords", () => {
    // Gemini answers HTTP 400 ("too many states") when a schema carries this
    // many maxLength/maxItems constraints, so none may be sent.
    const json = JSON.stringify(geminiAnalysisSchema);
    expect(json).not.toMatch(/"(maxLength|minLength|maxItems|minItems)"/);
    const p = geminiAnalysisSchema.properties;
    expect(p.dimensions.description).toContain("Between 4 and 4 items");
    expect(p.keywords.description).toContain(`At most ${LIMITS.keywords.max} items`);
    expect(p.matchedSkills.items.properties.evidence.description).toContain(
      `At most ${LIMITS.matchedSkills.evidence} characters`,
    );
    expect(p.experienceAlignment.items.required).toContain("importance");
  });

  it("uses only the OpenAPI subset Gemini accepts", () => {
    // Unions, $schema and additionalProperties are all rejected by the API.
    const serialised = JSON.stringify(geminiAnalysisSchema);
    expect(serialised).not.toContain("$schema");
    expect(serialised).not.toContain("additionalProperties");
    expect(serialised).not.toContain("anyOf");
    expect(serialised).not.toContain("oneOf");
  });
});
