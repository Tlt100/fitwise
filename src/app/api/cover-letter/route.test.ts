import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generate = vi.fn();
vi.mock("@/lib/ai/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini")>();
  return { ...actual, generate: (...args: unknown[]) => generate(...args) };
});

const { POST } = await import("./route");
const { POST: rewritePOST } = await import("../rewrite/route");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { GeminiError } = await import("@/lib/ai/gemini");

const RESUME = `Jane Doe
Software Engineer, Acme Corp
- Reduced API latency by 30% by introducing Redis caching for hot endpoints.
- Built a React and TypeScript dashboard used by 40 internal analysts.
`.repeat(3);
const JD = "We are hiring a frontend engineer to build data dashboards with React and TypeScript.";

function req(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test";
  resetRateLimits();
  generate.mockReset();
});

describe("POST /api/cover-letter", () => {
  it("503s when not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req("http://x/api/cover-letter", {}));
    expect(res.status).toBe(503);
  });

  it("400s on a bad body", async () => {
    const res = await POST(req("http://x/api/cover-letter", { resumeText: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid-request");
  });

  it("returns a grounded letter", async () => {
    generate.mockResolvedValue(
      JSON.stringify({
        paragraphs: ["Dear Hiring Manager,", "I reduced API latency by 30%. I worked at Google for 9 years.", "Sincerely,\nJane Doe"],
        claimsUsed: [
          { claim: "reduced API latency by 30%", resumeQuote: "Reduced API latency by 30% by introducing Redis caching" },
          { claim: "worked at Google for 9 years", resumeQuote: "Google, 9 years" },
        ],
      }),
    );
    const res = await POST(req("http://x/api/cover-letter", { resumeText: RESUME, jobDescription: JD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimsUsed).toHaveLength(1);
    expect(body.paragraphs.join(" ")).not.toContain("Google");
    expect(body.notes).toContainEqual({ kind: "missing-why-company" });
    const prompt = generate.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(prompt).toMatch(/<resume-[0-9a-f]{12}>/);
  });

  it("maps model failures and unreadable output", async () => {
    generate.mockRejectedValueOnce(new GeminiError("quota-exhausted", "x"));
    expect((await POST(req("http://x/api/cover-letter", { resumeText: RESUME, jobDescription: JD }))).status).toBe(429);
    generate.mockResolvedValueOnce("not json");
    expect((await POST(req("http://x/api/cover-letter", { resumeText: RESUME, jobDescription: JD }))).status).toBe(502);
  });
});

describe("POST /api/rewrite", () => {
  it("returns three checked variants", async () => {
    generate.mockResolvedValue(
      JSON.stringify({
        variants: [
          { text: "Frontend engineer | React, TypeScript", resumeQuotes: ["Built a React and TypeScript dashboard"] },
          { text: "Engineer who cut latency 30%", resumeQuotes: [] },
          { text: "Engineer with 12 years experience", resumeQuotes: [] },
        ],
        rationale: "Different emphasis.",
      }),
    );
    const res = await rewritePOST(req("http://x/api/rewrite", { kind: "linkedin-headline", resumeText: RESUME }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.variants).toHaveLength(3);
    expect(body.checks.map((c: { flagged: boolean }) => c.flagged)).toEqual([false, false, true]);
  });

  it("rejects an unknown kind", async () => {
    const res = await rewritePOST(req("http://x/api/rewrite", { kind: "tweet", resumeText: RESUME }));
    expect(res.status).toBe(400);
  });
});
