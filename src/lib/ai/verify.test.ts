import { describe, expect, it } from "vitest";
import type { Analysis } from "./analysis-schema";
import {
  findUnverifiedNumbers,
  quoteSupportScore,
  reconcileKeywords,
  verifyAnalysis,
  verifyQuotes,
} from "./verify";
import { matchResumeToJob } from "@/lib/match/keywords";

const resume = `Jane Doe
Backend Engineer

EXPERIENCE
Acme Payments
• Built a payments reconciliation service in Go that processes
  2 million transactions a day
• Migrated the billing API from REST to gRPC and cut p99 latency
• Mentored three junior engineers

SKILLS
Go, PostgreSQL, Docker, Kubernetes`;

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    roleTitle: "Backend Engineer",
    scoreRationale: "Good overlap.",
    dimensions: [],
    matchedSkills: [],
    missingSkills: [],
    experienceAlignment: [],
    resumeSuggestions: [],
    bulletRewrites: [],
    keywords: [],
    interviewTopics: [],
    actionPlan: [],
    ...overrides,
  };
}

describe("quoteSupportScore", () => {
  it("scores a verbatim quote as 1", () => {
    expect(quoteSupportScore("Migrated the billing API from REST to gRPC and cut p99 latency", resume)).toBe(1);
  });

  it("survives line wrapping, bullets and punctuation changes", () => {
    expect(
      quoteSupportScore("built a payments reconciliation service in Go that processes 2 million transactions a day", resume),
    ).toBe(1);
  });

  it("tolerates inflection", () => {
    expect(quoteSupportScore("Migrating the billing APIs from REST to gRPC", resume)).toBe(1);
  });

  it("does not add up words scattered across the whole document", () => {
    // Every word is somewhere in the resume, but never together.
    expect(
      quoteSupportScore("Mentored payments engineers on Kubernetes reconciliation billing", resume),
    ).toBeLessThan(0.8);
  });

  it("is 0 for an empty quote or an empty source", () => {
    expect(quoteSupportScore("", resume)).toBe(0);
    expect(quoteSupportScore("anything", "")).toBe(0);
  });
});

describe("verifyQuotes", () => {
  it("marks each quote verified or not, with its score", () => {
    const [found, invented] = verifyQuotes(
      ["Mentored three junior engineers", "Led a team of 12 engineers at Google"],
      resume,
    );
    expect(found).toMatchObject({ verified: true, score: 1 });
    expect(invented.verified).toBe(false);
    expect(invented.score).toBeLessThan(0.8);
  });

  it("accepts a custom threshold", () => {
    const [check] = verifyQuotes(["Mentored three junior designers"], resume, 0.5);
    expect(check.verified).toBe(true);
  });
});

describe("findUnverifiedNumbers", () => {
  it("flags figures the original does not contain", () => {
    expect(findUnverifiedNumbers("Cut p99 latency by 40%", "Cut p99 latency")).toEqual(["40%"]);
    expect(findUnverifiedNumbers("Saved $2M across 5 teams", "Saved money across teams")).toEqual(["$2M", "5"]);
  });

  it("accepts figures already in the original, however they are formatted", () => {
    expect(findUnverifiedNumbers("Processed 2,000,000 records", "processed 2000000 records")).toEqual([]);
    expect(findUnverifiedNumbers("Mentored 3 engineers", "Mentored 3 junior engineers")).toEqual([]);
  });

  it("catches number words", () => {
    expect(findUnverifiedNumbers("Doubled throughput", "Improved throughput")).toEqual(["doubled"]);
  });
});

describe("reconcileKeywords", () => {
  it("corrects model flags that disagree with the deterministic match", () => {
    const match = matchResumeToJob("Python and SQL", "Requirements\n- Python\n- Kubernetes");
    const { keywords, corrected } = reconcileKeywords(
      [
        { keyword: "python", presentInResume: false, guidance: "" },
        { keyword: "Kubernetes", presentInResume: true, guidance: "" },
        { keyword: "Something else", presentInResume: true, guidance: "" },
      ],
      match,
    );
    expect(keywords.map((k) => k.presentInResume)).toEqual([true, false, true]);
    expect(corrected).toBe(2);
  });
});

describe("verifyAnalysis", () => {
  it("marks evidence verified or paraphrased", () => {
    const { analysis: out, report } = verifyAnalysis(
      analysis({
        matchedSkills: [
          { skill: "Go", strength: "strong", evidence: "Built a payments reconciliation service in Go" },
          { skill: "Leadership", strength: "moderate", evidence: "Has led large cross-functional organisations" },
        ],
      }),
      resume,
    );
    expect(out.matchedSkills.map((s) => s.verified)).toEqual([true, false]);
    expect(report).toMatchObject({ evidenceChecked: 2, evidenceVerified: 1 });
  });

  it("drops rewrites whose original is not in the resume and flags new numbers", () => {
    const { analysis: out, report } = verifyAnalysis(
      analysis({
        bulletRewrites: [
          {
            section: "Experience",
            original: "Migrated the billing API from REST to gRPC and cut p99 latency",
            suggested: "Migrated the billing API to gRPC, cutting p99 latency by 35%",
            rationale: "Tighter.",
          },
          {
            section: "Experience",
            original: "Mentored three junior engineers",
            suggested: "Mentored three junior engineers through their first on-call rotation",
            rationale: "Specific.",
          },
          {
            section: "Experience",
            original: "Led the migration of 40 services to Kubernetes at Initech",
            suggested: "Led a 40-service Kubernetes migration",
            rationale: "Invented original.",
          },
        ],
      }),
      resume,
    );
    expect(out.bulletRewrites).toHaveLength(2);
    expect(out.bulletRewrites[0]).toMatchObject({ addsUnverifiedNumbers: true, unverifiedNumbers: ["35%"] });
    expect(out.bulletRewrites[1]).toMatchObject({ addsUnverifiedNumbers: false, unverifiedNumbers: [] });
    expect(report).toMatchObject({ rewritesChecked: 3, rewritesDropped: 1, rewritesWithNewNumbers: 1 });
  });

  it("overwrites any verified flag the model tried to set itself", () => {
    const { analysis: out } = verifyAnalysis(
      analysis({
        matchedSkills: [{ skill: "Rust", strength: "strong", evidence: "Wrote a Rust compiler", verified: true }],
      }),
      resume,
    );
    expect(out.matchedSkills[0].verified).toBe(false);
  });

  it("does not mutate its input", () => {
    const input = analysis({
      matchedSkills: [{ skill: "Go", strength: "strong", evidence: "Go" }],
    });
    verifyAnalysis(input, resume);
    expect(input.matchedSkills[0].verified).toBeUndefined();
  });
});
