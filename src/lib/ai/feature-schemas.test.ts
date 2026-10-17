import { describe, expect, it } from "vitest";
import {
  coverLetterRequestSchema,
  extractNumbers,
  groundCoverLetter,
  groundRewrite,
  isQuoteSupported,
  normalizeCoverLetter,
  normalizeRewrite,
  parseModelJson,
  quoteOverlap,
  rewriteRequestSchema,
  summarizeAnalysis,
  unsupportedNumbers,
} from "./feature-schemas";

const RESUME = `Jane Doe
Software Engineer, Acme Corp (2019 - 2023)
- Built a React and TypeScript dashboard used by 40 internal analysts.
- Reduced API latency by 30% by introducing Redis caching for hot endpoints.
- Mentored two junior engineers through code review and pairing.
Skills: Python, PostgreSQL, Docker, Kubernetes
`.repeat(2);

describe("request schemas", () => {
  it("applies cover-letter defaults and trims optional text", () => {
    const parsed = coverLetterRequestSchema.parse({
      resumeText: RESUME,
      jobDescription: "We are hiring a frontend engineer to build dashboards in React.",
      options: { companyName: "  ", whyThisCompany: " I use your product daily. " },
    });
    expect(parsed.options.tone).toBe("professional");
    expect(parsed.options.length).toBe(250);
    expect(parsed.options.companyName).toBeUndefined();
    expect(parsed.options.whyThisCompany).toBe("I use your product daily.");
  });

  it("rejects an unknown length or tone", () => {
    const base = { resumeText: RESUME, jobDescription: "x".repeat(100) };
    expect(() => coverLetterRequestSchema.parse({ ...base, options: { length: 999 } })).toThrow();
    expect(() => coverLetterRequestSchema.parse({ ...base, options: { tone: "salty" } })).toThrow();
  });

  it("allows a rewrite without a job description", () => {
    const parsed = rewriteRequestSchema.parse({ kind: "linkedin-headline", resumeText: RESUME });
    expect(parsed.jobDescription).toBeNull();
  });
});

describe("parseModelJson", () => {
  it("tolerates a code fence", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson("not json")).toBeNull();
  });
});

describe("quote grounding", () => {
  it("accepts a verbatim quote, ignoring case and punctuation", () => {
    expect(quoteOverlap("reduced API latency by 30%", RESUME)).toBe(1);
    expect(isQuoteSupported("- Reduced API latency by 30% by introducing Redis caching", RESUME)).toBe(true);
  });

  it("accepts a near quote with one word changed", () => {
    expect(
      isQuoteSupported("Built a React and TypeScript dashboard used by 40 analysts", RESUME),
    ).toBe(true);
  });

  it("rejects a fabricated quote even when its words are common", () => {
    expect(isQuoteSupported("Led a team of 12 engineers at Google", RESUME)).toBe(false);
    expect(isQuoteSupported("Built a Kubernetes platform used by 40 teams at Acme", RESUME)).toBe(false);
  });

  it("rejects one-word quotes", () => {
    expect(isQuoteSupported("Python", RESUME)).toBe(false);
  });
});

describe("numeric guard", () => {
  it("normalises separators", () => {
    expect(extractNumbers("Grew revenue to $10,000 and 2.0x, 30%")).toEqual(["10000", "2", "30"]);
  });

  it("flags numbers absent from every source", () => {
    expect(unsupportedNumbers("Cut latency 30% for 40 analysts over 5 years", RESUME)).toEqual(["5"]);
    expect(unsupportedNumbers("5 years", RESUME, "I have followed you for 5 years")).toEqual([]);
  });
});

describe("normalizeCoverLetter", () => {
  it("returns null without paragraphs", () => {
    expect(normalizeCoverLetter({ paragraphs: [] })).toBeNull();
    expect(normalizeCoverLetter("nope")).toBeNull();
  });

  it("drops junk and truncates", () => {
    const out = normalizeCoverLetter({
      paragraphs: ["Dear Hiring Manager,", 42, "", "x".repeat(5000)],
      claimsUsed: [{ claim: "c", resumeQuote: "q" }, { nope: true }, "bad"],
    });
    expect(out?.paragraphs).toHaveLength(2);
    expect(out?.paragraphs[1]).toHaveLength(1600);
    expect(out?.claimsUsed).toEqual([{ claim: "c", resumeQuote: "q" }]);
  });
});

describe("groundCoverLetter", () => {
  it("keeps supported claims, removes the sentence for an unsupported one, flags numbers", () => {
    const result = groundCoverLetter(
      {
        paragraphs: [
          "Dear Hiring Manager,",
          "At Acme I reduced API latency by 30% with Redis caching. I also led a team of 12 engineers at Google.",
          "I have shipped software for 7 years.",
          "Sincerely,\nJane Doe",
        ],
        claimsUsed: [
          { claim: "reduced API latency by 30% with Redis caching", resumeQuote: "Reduced API latency by 30% by introducing Redis caching" },
          { claim: "led a team of 12 engineers at Google", resumeQuote: "Led a team of 12 engineers at Google" },
        ],
      },
      RESUME,
    );
    expect(result.claimsUsed).toHaveLength(1);
    expect(result.paragraphs[1]).not.toMatch(/Google/);
    expect(result.paragraphs[1]).toMatch(/Redis/);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ kind: "unsupported-claim", removedSentence: true }),
    );
    expect(result.notes).toContainEqual({ kind: "unsupported-number", value: "7", paragraph: 2 });
  });

  it("allows numbers the user typed", () => {
    const result = groundCoverLetter(
      { paragraphs: ["I have used your app since 2015."], claimsUsed: [] },
      RESUME,
      "I have used your app since 2015",
    );
    expect(result.notes).toEqual([]);
  });
});

describe("rewrites", () => {
  it("dedupes, caps at three and truncates to the kind's limit", () => {
    const raw = normalizeRewrite(
      {
        variants: [
          { text: "A".repeat(500), resumeQuotes: [] },
          "Engineer | React",
          "engineer | react",
          { text: "Three" },
          { text: "Four" },
        ],
        rationale: "why",
      },
      "linkedin-headline",
    );
    expect(raw?.variants.map((v) => v.text.length)).toEqual([220, 16, 5]);
  });

  it("flags variants with invented numbers or quotes", () => {
    const result = groundRewrite(
      {
        variants: [
          { text: "Engineer who cut API latency 30%.", resumeQuotes: ["Reduced API latency by 30%"] },
          { text: "Engineer with 10 years of experience.", resumeQuotes: [] },
          { text: "Engineer.", resumeQuotes: ["Won the Turing Award in 2020"] },
        ],
        rationale: "",
      },
      "summary",
      RESUME,
    );
    expect(result.checks.map((c) => c.flagged)).toEqual([false, true, true]);
    expect(result.checks[1].unsupportedNumbers).toEqual(["10"]);
    expect(result.variants).toHaveLength(3);
  });
});

describe("summarizeAnalysis", () => {
  it("summarises loosely and ignores junk", () => {
    expect(summarizeAnalysis(null)).toBeUndefined();
    const s = summarizeAnalysis({
      roleTitle: "Frontend Engineer",
      overallScore: 71.6,
      matchedSkills: [{ skill: "React" }, { skill: 3 }],
      missingSkills: [{ skill: "GraphQL" }],
    });
    expect(s).toContain("Role: Frontend Engineer");
    expect(s).toContain("72/100");
    expect(s).toContain("Evidenced skills: React");
    expect(s).toContain("GraphQL");
  });
});
