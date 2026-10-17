import { describe, expect, it } from "vitest";
import { buildDraft } from "./build-draft";

const resume = [
  "Jane Doe",
  "Senior Engineer",
  "",
  "Experience",
  "- Built a payments service in Go",
  "- Led a team of four engineers",
].join("\n");

describe("buildDraft", () => {
  it("substitutes an accepted rewrite in place", () => {
    const { text, applied } = buildDraft(resume, [
      {
        original: "Built a payments service in Go",
        replacement: "Built and shipped a payments service in Go",
      },
    ]);
    expect(text).toContain("- Built and shipped a payments service in Go");
    expect(applied).toHaveLength(1);
  });

  it("keeps the document's own bullet prefix", () => {
    const { text } = buildDraft("* Shipped the API", [
      { original: "Shipped the API", replacement: "- Shipped the public API" },
    ]);
    expect(text).toBe("* Shipped the public API");
  });

  it("matches despite differing whitespace and bullet glyphs", () => {
    const { applied } = buildDraft(resume, [
      { original: "•  Led a team   of four engineers", replacement: "Led four engineers" },
    ]);
    expect(applied).toHaveLength(1);
  });

  it("reports a rewrite it cannot place instead of guessing", () => {
    const { text, unapplied } = buildDraft(resume, [
      { original: "Managed a $2M budget", replacement: "Managed a $2M budget well" },
    ]);
    expect(unapplied).toEqual(["Managed a $2M budget"]);
    expect(text).toBe(resume);
  });

  it("leaves every other line untouched", () => {
    const { text } = buildDraft(resume, [
      { original: "Led a team of four engineers", replacement: "Led four engineers" },
    ]);
    expect(text.split("\n")).toHaveLength(resume.split("\n").length);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("- Built a payments service in Go");
  });

  it("applies several rewrites in one pass", () => {
    const { applied } = buildDraft(resume, [
      { original: "Built a payments service in Go", replacement: "A" },
      { original: "Led a team of four engineers", replacement: "B" },
    ]);
    expect(applied).toHaveLength(2);
  });

  it("ignores an empty original rather than matching everything", () => {
    const { text, unapplied } = buildDraft(resume, [
      { original: "   ", replacement: "Nope" },
    ]);
    expect(text).toBe(resume);
    expect(unapplied).toHaveLength(1);
  });

  it("prefers the exact line over an earlier line that contains it", () => {
    const text = ["- Built a payments service in Go and Rust", "- Built a payments service in Go"].join("\n");
    const { text: out } = buildDraft(text, [
      { original: "Built a payments service in Go", replacement: "Shipped it" },
    ]);
    expect(out.split("\n")).toEqual(["- Built a payments service in Go and Rust", "- Shipped it"]);
  });

  it("never rewrites the same line twice", () => {
    const { text, applied, unapplied } = buildDraft("- Led a team of four engineers", [
      { original: "Led a team of four engineers", replacement: "Led four engineers" },
      { original: "four engineers", replacement: "Clobbered" },
    ]);
    expect(text).toBe("- Led four engineers");
    expect(applied).toHaveLength(1);
    expect(unapplied).toEqual(["four engineers"]);
  });
});
