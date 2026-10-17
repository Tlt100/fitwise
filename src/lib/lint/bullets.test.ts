import { describe, expect, it } from "vitest";
import { GOOD_RESUME, INCONSISTENT_DATES_RESUME, NO_CONTACT_RESUME } from "@/lib/ats/__fixtures__/resumes";
import { BULLET_FORMULA, hasMetric, lintBullet, lintBullets, weakest } from "./bullets";
import { baseVerb } from "./verbs";

const ids = (text: string) => lintBullet(text).flags.map((f) => f.id);

describe("lintBullet", () => {
  it("gives a strong, quantified, well-formed bullet full marks", () => {
    const b = lintBullet("Reduced checkout latency by 38% for 2M monthly users by caching pricing lookups in Redis.");
    expect(b.score).toBe(3);
    expect(b.flags).toEqual([]);
    expect(b.verb).toBe("reduced");
    expect(b.suggestion).toBe("");
  });

  it.each([
    ["Responsible for managing the onboarding process for new hires", "weak-opener"],
    ["Helped the team migrate services to the cloud platform", "weak-opener"],
    ["Worked on the internal billing dashboard for the finance team", "weak-opener"],
    ["Duties included answering phones and greeting visitors at the front desk", "weak-opener"],
    ["Assisted senior engineers with code reviews and release testing", "weak-opener"],
  ])("flags the weak opener in %j", (text, flag) => {
    const b = lintBullet(text);
    expect(b.flags.map((f) => f.id)).toContain(flag);
    expect(b.verb).toBeUndefined();
  });

  it("flags a bullet with no action verb", () => {
    expect(ids("Customer onboarding and account setup for enterprise clients")).toContain("no-action-verb");
  });

  it("recognises present-tense and -ing verbs", () => {
    expect(baseVerb("Lead")).toBe("led");
    expect(baseVerb("Building")).toBe("built");
    expect(baseVerb("designing")).toBe("designed");
    expect(baseVerb("Optimizes")).toBe("optimized");
    expect(baseVerb("Plan")).toBe("planned");
    expect(baseVerb("Things")).toBeNull();
  });

  it("detects metrics but ignores years and product codes", () => {
    expect(hasMetric("Cut costs by $40K")).toBe(true);
    expect(hasMetric("Grew signups 3x")).toBe(true);
    expect(hasMetric("Lifted retention 12%")).toBe(true);
    expect(hasMetric("Doubled weekly active users")).toBe(true);
    expect(hasMetric("Migrated storage to S3 and EC2 in 2021")).toBe(false);
    expect(hasMetric("Led the redesign of the HTML5 player")).toBe(false);
  });

  it("flags length problems", () => {
    expect(ids("Built the API.")).toContain("too-short");
    const long = `Led ${"a very long and winding description of the work ".repeat(5)}with 3 teams.`;
    expect(ids(long)).toContain("too-long");
  });

  it("flags first person, passive voice and buzzwords", () => {
    expect(ids("Built a dashboard that I used to track 12 KPIs for my team")).toContain("first-person");
    expect(ids("Reports were prepared weekly for 6 regional directors and the CFO")).toContain("passive");
    expect(ids("Delivered results-driven campaigns as a team player across 4 regions")).toContain("buzzword");
  });

  it("does not mistake 'US' or 'I/O' for first person", () => {
    expect(ids("Expanded US distribution to 40 new retail partners in 9 months")).not.toContain("first-person");
    expect(ids("Optimized disk I/O for 200 database hosts, cutting p99 latency 30%")).not.toContain("first-person");
  });

  it("writes suggestions with placeholders, never invented numbers", () => {
    const b = lintBullet("Responsible for the weekly labor schedule.");
    expect(b.suggestion).toContain("[your real result");
    expect(b.suggestion).toContain("[how you did it]");
    expect(b.suggestion).not.toMatch(/\d/);
    expect(b.flags.find((f) => f.id === "no-metric")?.advice).toMatch(/real number/i);
    expect(b.flags.find((f) => f.id === "no-metric")?.advice).toMatch(/do not estimate/i);
  });
});

describe("lintBullets", () => {
  it("summarises a strong resume", () => {
    const report = lintBullets(GOOD_RESUME);
    expect(report.total).toBe(10);
    expect(report.withMetric).toBe(10);
    expect(report.summary).toBe("10 of 10 bullets show a measurable result; 10 open with a strong action verb.");
    expect(report.averageScore).toBe(3);
    expect(report.detection).toBe("markers");
    expect(report.formula).toBe(BULLET_FORMULA);
  });

  it("ranks the weakest bullets first", () => {
    const report = lintBullets(INCONSISTENT_DATES_RESUME);
    const worst = weakest(report, 2);
    expect(worst.map((b) => b.text)).toEqual(["Helped with the website redesign.", "Worked on social media posts."]);
    expect(report.weakestIndices.slice(0, 2)).toEqual(worst.map((b) => b.index));
    expect(report.summary).toBe("4 of 6 bullets show a measurable result; 4 open with a strong action verb.");
    expect(report.flagCounts["weak-opener"]).toBe(2);
  });

  it("joins bullets that wrap across lines in PDF text", () => {
    const report = lintBullets(`Experience
- Led checkout redesign lifting conversion
18% for 2M monthly shoppers
- Created a design system used by 40
designers across 6 product teams`);
    expect(report.total).toBe(2);
    expect(report.bullets[0].text).toBe("Led checkout redesign lifting conversion 18% for 2M monthly shoppers");
  });

  it("skips skills and education lists", () => {
    const report = lintBullets(`Skills
- Python, SQL, Go, Rust, Docker
Education
- B.S. Computer Science
Experience
- Built a feature store serving 300 models in production at 5ms p99`);
    expect(report.total).toBe(1);
  });

  it("flags the third and later use of the same opening verb", () => {
    const text = ["Experience", ...[1, 2, 3, 4].map((n) => `- Managed ${n * 10} vendors across the northeast region for the retail group`)].join("\n");
    const report = lintBullets(text);
    const repeated = report.bullets.filter((b) => b.flags.some((f) => f.id === "repeated-verb"));
    expect(repeated.map((b) => b.index)).toEqual([2, 3]);
  });

  it("infers bullets when list markers were stripped (DOCX raw text)", () => {
    const report = lintBullets(`Experience
Operations Manager, Harbor Supply
Managed a team of 35 associates across two shifts with 99% accuracy
Responsible for the weekly labor schedule and vendor calls`);
    expect(report.detection).toBe("inferred");
    expect(report.total).toBe(2);
  });

  it("reports when there are no bullets", () => {
    const report = lintBullets("Jane Doe\nA paragraph about my career that never uses bullets.");
    expect(report.total).toBe(0);
    expect(report.detection).toBe("none");
    expect(report.summary).toMatch(/No bullet points/);
  });

  it("handles a mixed resume", () => {
    const report = lintBullets(NO_CONTACT_RESUME);
    expect(report.total).toBe(6);
    expect(weakest(report, 1)[0].text).toBe("Responsible for the weekly labor schedule.");
  });
});
