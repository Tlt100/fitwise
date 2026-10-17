import { describe, expect, it } from "vitest";
import { composeScore, requirementEvidenceScore, scoreLabel, SCORE_WEIGHTS } from "./score";

describe("requirementEvidenceScore", () => {
  it("weights statuses by importance", () => {
    // critical met (3*1) + important partial (2*0.5) + nice not-evident (1*0) = 4 of 6
    expect(
      requirementEvidenceScore([
        { status: "met", importance: "critical" },
        { status: "partial", importance: "important" },
        { status: "not-evident", importance: "nice-to-have" },
      ]),
    ).toBe(67);
  });

  it("treats a missing importance as important", () => {
    expect(requirementEvidenceScore([{ status: "partial" }])).toBe(50);
  });

  it("is null with no requirements", () => {
    expect(requirementEvidenceScore([])).toBeNull();
  });

  it("lets a missed critical requirement outweigh a met nice-to-have", () => {
    const score = requirementEvidenceScore([
      { status: "not-evident", importance: "critical" },
      { status: "met", importance: "nice-to-have" },
    ]);
    expect(score).toBe(25);
  });
});

describe("composeScore", () => {
  it("uses the documented weights when every component is present", () => {
    const result = composeScore({
      keywordCoveragePct: 50,
      requirements: [{ status: "met", importance: "critical" }],
      atsReadiness: 80,
    });
    const expected = Math.round(
      (SCORE_WEIGHTS.keywords * 50 + SCORE_WEIGHTS.requirements * 100 + SCORE_WEIGHTS.ats * 80) /
        (SCORE_WEIGHTS.keywords + SCORE_WEIGHTS.requirements + SCORE_WEIGHTS.ats),
    );
    expect(result.composite).toBe(expected);
    expect(result.components.map((c) => c.id)).toEqual(["keywords", "requirements", "ats"]);
    expect(result.components.reduce((s, c) => s + c.effectiveWeight, 0)).toBeCloseTo(1, 2);
  });

  it("renormalises when the ATS check has not run", () => {
    const result = composeScore({
      keywordCoveragePct: 40,
      requirements: [{ status: "met", importance: "important" }],
    });
    expect(result.composite).toBe(Math.round((0.4 * 40 + 0.45 * 100) / 0.85));
    const ats = result.components.find((c) => c.id === "ats")!;
    expect(ats.score).toBeNull();
    expect(ats.effectiveWeight).toBe(0);
  });

  it("clamps out-of-range inputs", () => {
    const result = composeScore({ keywordCoveragePct: 140, requirements: [], atsReadiness: -5 });
    expect(result.components[0].score).toBe(100);
    expect(result.components[2].score).toBe(0);
  });

  it("is null, not zero, when nothing could be measured", () => {
    const result = composeScore({ keywordCoveragePct: null, requirements: [] });
    expect(result.composite).toBeNull();
    expect(result.label).toBe("Not enough to score");
  });

  it("documents the formula and never talks about hiring odds", () => {
    const result = composeScore({ keywordCoveragePct: 70, requirements: [] });
    expect(result.formula).toMatch(/40%/);
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toMatch(/probabilit|likelihood|chance|odds|hired/);
  });
});

describe("scoreLabel", () => {
  it("describes alignment bands", () => {
    expect(scoreLabel(90)).toBe("Strong alignment");
    expect(scoreLabel(70)).toBe("Good alignment");
    expect(scoreLabel(55)).toBe("Partial alignment");
    expect(scoreLabel(40)).toBe("Limited alignment");
    expect(scoreLabel(10)).toBe("Low alignment");
  });
});
