import { describe, expect, it } from "vitest";
import { countWords, normalizeExtractedText } from "./normalize";
import { MAX_RESUME_CHARS } from "@/lib/limits";

describe("normalizeExtractedText", () => {
  it("expands ligatures so keywords match", () => {
    expect(normalizeExtractedText("Improved workﬂow efﬁciency")).toBe(
      "Improved workflow efficiency",
    );
  });

  it("flattens smart punctuation", () => {
    expect(normalizeExtractedText("“Led” the team — daily")).toBe(
      '"Led" the team - daily',
    );
  });

  it("converts bullet glyphs to hyphens", () => {
    expect(normalizeExtractedText("• Shipped the API")).toBe("- Shipped the API");
  });

  it("collapses runs of blank lines but keeps paragraph breaks", () => {
    expect(normalizeExtractedText("A\n\n\n\n\nB")).toBe("A\n\nB");
  });

  it("strips control characters and trailing spaces", () => {
    expect(normalizeExtractedText("Engineer   \n  Role  ")).toBe(
      "Engineer\n Role",
    );
  });

  it("normalises Windows line endings", () => {
    expect(normalizeExtractedText("A\r\nB")).toBe("A\nB");
  });

  it("truncates past the cap and says so", () => {
    const result = normalizeExtractedText("x".repeat(MAX_RESUME_CHARS + 500));
    expect(result).toContain("Truncated");
  });

  it("keeps a truncated resume within the cap the analyze route enforces", () => {
    const result = normalizeExtractedText("word ".repeat(MAX_RESUME_CHARS));
    expect(result.length).toBeLessThanOrEqual(MAX_RESUME_CHARS);
  });

  it("removes soft hyphens and zero-width characters inside words", () => {
    expect(normalizeExtractedText("Kuber­netes ﻿Go​")).toBe("Kubernetes Go");
  });

  it("strips NUL and other control characters", () => {
    expect(normalizeExtractedText("A\u0000B\u0007C\tD")).toBe("ABC D");
  });

  it("leaves ordinary text alone", () => {
    const text = "Senior Engineer\n\n- Built a payments service in Go";
    expect(normalizeExtractedText(text)).toBe(text);
  });
});

describe("countWords", () => {
  it("treats hyphenated terms as single words", () => {
    expect(countWords("Built 3 APIs — résumé-ready, well-tested")).toBe(5);
  });

  it("returns zero for an empty text layer", () => {
    expect(countWords("   \n \n ")).toBe(0);
  });
});
