import { describe, expect, it } from "vitest";
import { normKey, stem, stemKey, tokenize } from "./stem";

describe("tokenize", () => {
  it("keeps C++, C#, .NET and Node.js intact", () => {
    const raws = tokenize("C, C++, C# and .NET; also Node.js.").map((t) => t.raw);
    expect(raws).toEqual(["C", "C++", "C#", "and", ".NET", "also", "Node.js"]);
  });

  it("splits hyphens and slashes so spellings meet", () => {
    expect(normKey("cross-functional")).toBe(normKey("cross functional"));
    expect(normKey("CI/CD")).toBe("ci cd");
  });

  it("keeps ampersand compounds", () => {
    expect(tokenize("R&D and P&L").map((t) => t.norm)).toEqual(["r&d", "and", "p&l"]);
  });

  it("drops ellipsis dots and possessives", () => {
    expect(tokenize("...and the company's").map((t) => t.norm)).toEqual(["and", "the", "company"]);
  });

  it("normalises curly quotes and typographic dashes", () => {
    expect(normKey("bachelor’s degree")).toBe(normKey("bachelor's degree"));
    expect(normKey("front–end")).toBe("front end");
  });

  it("flags sentence starts, hyphens and trailing periods", () => {
    const tokens = tokenize("Go-to-market. R. Smith");
    const [go, to] = tokens;
    expect(go.sentenceStart).toBe(true);
    expect(go.hyphenAfter).toBe(true);
    expect(to.sentenceStart).toBe(false);
    expect(tokens[3].raw).toBe("R");
    expect(tokens[3].periodAfter).toBe(true);
  });

  it("treats a free-standing dash as a bullet but a glued one as a join", () => {
    const tokens = tokenize("- Go and cross-functional");
    expect(tokens[0].sentenceStart).toBe(true);
    expect(tokens[3].sentenceStart).toBe(false);
  });

  it("tracks line numbers", () => {
    expect(tokenize("a\nb\n\nc").map((t) => t.line)).toEqual([0, 1, 3]);
  });
});

describe("stem", () => {
  it("folds plurals and tenses together", () => {
    expect(stem("pipelines")).toBe(stem("pipeline"));
    expect(stem("managing")).toBe(stem("manage"));
    expect(stem("managed")).toBe(stem("manage"));
    expect(stem("technologies")).toBe(stem("technology"));
    expect(stem("planning")).toBe(stem("plan"));
    expect(stem("applied")).toBe(stem("apply"));
    expect(stem("processes")).toBe(stem("process"));
  });

  it("folds British -ise spellings onto -ize", () => {
    expect(stem("optimise")).toBe(stem("optimize"));
    expect(stem("optimising")).toBe(stem("optimizing"));
    expect(stem("containerisation")).toBe(stem("containerization"));
  });

  it("does not strip -ing from vowel-less roots", () => {
    expect(stem("spring")).toBe("spring");
    expect(stem("string")).toBe("string");
  });

  it("leaves -ss, -us and -is endings alone", () => {
    expect(stem("business")).toBe("business");
    expect(stem("status")).toBe("status");
    expect(stem("analysis")).toBe("analysis");
  });

  it("never touches tokens with digits or symbols", () => {
    expect(stem("c++")).toBe("c++");
    expect(stem("s3")).toBe("s3");
    expect(stem("node.js")).toBe("node.js");
  });

  it("stems plural acronyms to the singular", () => {
    expect(stemKey("APIs and KPIs")).toBe(stemKey("API and KPI"));
  });

  it("builds identical keys for inflected phrases", () => {
    expect(stemKey("Data Pipelines")).toBe(stemKey("data pipeline"));
  });
});
