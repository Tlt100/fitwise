import { describe, expect, it } from "vitest";
import { isAnalysisStale } from "./session-context";
import type { Analysis } from "@/lib/ai/analysis-schema";

// Only the presence of an analysis matters here, not its contents.
const analysis = { overallScore: 70 } as unknown as Analysis;

describe("isAnalysisStale", () => {
  it("is never stale when there is no analysis", () => {
    expect(
      isAnalysisStale({
        analysis: null,
        jobDescription: "anything",
        analyzedJobDescription: null,
      }),
    ).toBe(false);
  });

  it("is fresh while the posting is unchanged", () => {
    expect(
      isAnalysisStale({
        analysis,
        jobDescription: "Backend engineer",
        analyzedJobDescription: "Backend engineer",
      }),
    ).toBe(false);
  });

  it("ignores surrounding whitespace, which the request trims anyway", () => {
    expect(
      isAnalysisStale({
        analysis,
        jobDescription: "  Backend engineer\n",
        analyzedJobDescription: "Backend engineer",
      }),
    ).toBe(false);
  });

  it("goes stale once the posting changes", () => {
    expect(
      isAnalysisStale({
        analysis,
        jobDescription: "Frontend engineer",
        analyzedJobDescription: "Backend engineer",
      }),
    ).toBe(true);
  });

  it("treats a cleared posting as stale", () => {
    expect(
      isAnalysisStale({
        analysis,
        jobDescription: "",
        analyzedJobDescription: "Backend engineer",
      }),
    ).toBe(true);
  });
});
