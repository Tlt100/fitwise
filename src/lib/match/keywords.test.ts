import { describe, expect, it } from "vitest";
import {
  detectJdSections,
  detectResumeSections,
  extractJdTerms,
  matchResumeToJob,
  matchTerms,
  STATUS_CREDIT,
  summarize,
  type TermMatch,
} from "./keywords";
import { getLexicon, parseForm } from "./lexicon";
import { tokenize } from "./stem";

const names = (jd: string) => extractJdTerms(jd).map((t) => t.term);
const termOf = (result: ReturnType<typeof matchResumeToJob>, term: string) =>
  result.terms.find((t) => t.term === term);

describe("lexicon", () => {
  it("is large enough to be useful across fields", () => {
    const lexicon = getLexicon();
    expect(lexicon.length).toBeGreaterThanOrEqual(800);
    const domains = new Set(lexicon.map((e) => e.domain));
    for (const d of ["software", "data", "cloud", "design", "product", "marketing", "sales", "finance", "healthcare", "operations", "soft", "credentials"]) {
      expect(domains).toContain(d);
    }
    const categories = new Set(lexicon.map((e) => e.category));
    expect([...categories].sort()).toEqual(["cert", "hard", "soft", "tool"]);
  });

  it("has unique canonical names", () => {
    const seen = new Map<string, number>();
    for (const e of getLexicon()) seen.set(e.name.toLowerCase(), (seen.get(e.name.toLowerCase()) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([name]) => name)).toEqual([]);
  });

  it("never lets two entries claim the same form", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of getLexicon()) {
      for (const form of entry.forms) {
        const { text, caseSensitive } = parseForm(form);
        const tokens = tokenize(text);
        const key = (caseSensitive ? tokens.map((t) => t.raw) : tokens.map((t) => t.stem)).join(" ");
        const scoped = `${caseSensitive ? "cs" : "ci"}:${key}`;
        const prior = owner.get(scoped);
        if (prior && prior !== entry.name) clashes.push(`${form} (${entry.name} vs ${prior})`);
        owner.set(scoped, entry.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps every form within the four-token window", () => {
    const tooLong = getLexicon().flatMap((e) =>
      e.forms.filter((f) => tokenize(parseForm(f).text).length > 4 || tokenize(parseForm(f).text).length === 0),
    );
    expect(tooLong).toEqual([]);
  });
});

describe("extractJdTerms", () => {
  it("finds lexicon terms through aliases", () => {
    const found = names("We use JS, k8s, Postgres and ML daily.");
    expect(found).toEqual(expect.arrayContaining(["JavaScript", "Kubernetes", "PostgreSQL", "machine learning"]));
  });

  it("matches multi-word terms longest-first", () => {
    const found = names("Experience with React Native and Google Cloud Platform.");
    expect(found).toContain("React Native");
    expect(found).not.toContain("React");
    expect(found).toContain("Google Cloud Platform");
  });

  it("keeps Java and JavaScript apart", () => {
    const found = names("Strong Java background; JavaScript a plus.");
    expect(found).toContain("Java");
    expect(found).toContain("JavaScript");
  });

  it("detects C, C++, C# and .NET without confusing them", () => {
    const found = names("Languages: C, C++, C# and .NET Core.");
    expect(found).toEqual(expect.arrayContaining(["C", "C++", "C#", ".NET"]));
  });

  it("does not read ordinary English as a case-sensitive tool name", () => {
    const found = names("You will excel at helping teams go faster and react to change. Slack time is protected.");
    expect(found).not.toContain("Microsoft Excel");
    expect(found).not.toContain("Go");
    expect(found).not.toContain("React");
  });

  it("rejects strict forms at the start of a sentence before a lower-case word", () => {
    expect(names("Go above and beyond for customers.")).not.toContain("Go");
    expect(names("Go-to-market plans.")).not.toContain("Go");
    expect(names("Backend services in Go, Python and Rust.")).toContain("Go");
    expect(names("- Go experience is a plus")).toContain("Go");
    expect(names("Lean into ambiguity.")).not.toContain("Lean");
  });

  it("never joins a phrase across punctuation", () => {
    const found = names("Experience with AWS (S3, Glue, Redshift)");
    expect(found).toEqual(expect.arrayContaining(["AWS", "Amazon S3", "Redshift"]));
    expect(names("Skills: Python\nSQL")).toEqual(expect.arrayContaining(["Python", "SQL"]));
  });

  it("ignores case-sensitive acronyms on all-caps lines", () => {
    expect(names("MAKE IT HAPPEN WITH US\nWe build things.")).not.toContain("information technology");
  });

  it("weights requirements above responsibilities above nice-to-haves", () => {
    const jd = [
      "Responsibilities",
      "- Build services with Docker",
      "Requirements",
      "- 5+ years of Python",
      "Nice to have",
      "- Experience with Rust",
    ].join("\n");
    const terms = extractJdTerms(jd);
    const w = (name: string) => terms.find((t) => t.term === name)?.weight ?? -1;
    expect(w("Python")).toBeGreaterThan(w("Docker"));
    expect(w("Docker")).toBeGreaterThan(w("Rust"));
    expect(terms.find((t) => t.term === "Python")?.required).toBe(true);
    expect(terms.find((t) => t.term === "Rust")?.required).toBe(false);
    expect(terms.find((t) => t.term === "Docker")?.required).toBe(false);
  });

  it("treats a preferred line inside a requirements section as preferred", () => {
    const jd = "Requirements:\n- SQL\n- Tableau is a plus\n";
    const terms = extractJdTerms(jd);
    expect(terms.find((t) => t.term === "SQL")?.required).toBe(true);
    expect(terms.find((t) => t.term === "Tableau")?.required).toBe(false);
  });

  it("drops terms that only appear in benefits or about-us boilerplate", () => {
    const jd = "Requirements\n- Python\n\nBenefits\n- Free Peloton and Slack credits\n\nAbout Acme\nAcme is an AI company.";
    const found = names(jd);
    expect(found).toContain("Python");
    expect(found).not.toContain("Slack");
    expect(found).not.toContain("artificial intelligence");
  });

  it("treats an About the role section as content, not boilerplate", () => {
    expect(names("About the role\nYou will write Terraform.")).toContain("Terraform");
  });

  it("boosts repeated terms but caps the bonus", () => {
    const once = extractJdTerms("Requirements\n- Python").find((t) => t.term === "Python")!;
    const many = extractJdTerms("Requirements\n- Python\n- Python\n- Python\n- Python\n- Python\n- Python").find((t) => t.term === "Python")!;
    expect(many.weight).toBeGreaterThan(once.weight);
    expect(many.weight).toBeLessThanOrEqual(once.weight + 1.5);
    expect(many.count).toBe(6);
  });

  it("halves the weight of soft skills", () => {
    const terms = extractJdTerms("Requirements\n- Python\n- communication skills");
    const python = terms.find((t) => t.term === "Python")!;
    const comms = terms.find((t) => t.term === "communication")!;
    expect(comms.weight).toBeCloseTo(python.weight / 2);
  });

  it("mines acronyms and CamelCase names the lexicon does not know", () => {
    const terms = extractJdTerms("Requirements\n- Experience with FooDB and the XYZQ protocol\n- Apply to the EEO office in the US");
    const found = terms.map((t) => t.term);
    expect(found).toContain("FooDB");
    expect(found).toContain("XYZQ");
    expect(found).not.toContain("EEO");
    expect(found).not.toContain("US");
    expect(terms.find((t) => t.term === "FooDB")?.source).toBe("candidate");
  });

  it("treats every hard skill as required when the posting has no structure", () => {
    const terms = extractJdTerms("We are hiring someone who knows Python and SQL and has good communication.");
    expect(terms.find((t) => t.term === "Python")?.required).toBe(true);
    expect(terms.find((t) => t.term === "communication")?.required).toBe(false);
  });

  it("returns nothing for an empty posting", () => {
    expect(extractJdTerms("")).toEqual([]);
  });
});

describe("section detection", () => {
  it("reads JD headings in several styles", () => {
    const jd = "WHAT YOU'LL DO\nship\n## Minimum qualifications\nPython\nPreferred Qualifications:\nGo\nPerks\ngym";
    expect(detectJdSections(jd)).toEqual([
      "responsibilities",
      "responsibilities",
      "required",
      "required",
      "preferred",
      "preferred",
      "ignore",
      "ignore",
    ]);
  });

  it("labels an inline 'Label: content' line without switching section", () => {
    const jd = "Requirements\nLocation: Remote\nPython";
    expect(detectJdSections(jd)).toEqual(["required", "ignore", "required"]);
  });

  it("reads resume headings and ignores job titles and employers", () => {
    const resume = [
      "Jane Doe",
      "Backend engineer who ships.",
      "TECHNICAL SKILLS",
      "Python, Go",
      "Work Experience",
      "Senior Software Engineer",
      "Acme Technologies Inc",
      "- Built things",
      "Education",
      "BSc Computer Science",
    ].join("\n");
    expect(detectResumeSections(resume)).toEqual([
      "summary",
      "summary",
      "skills",
      "skills",
      "experience",
      "experience",
      "experience",
      "experience",
      "other",
      "other",
    ]);
  });
});

describe("matchTerms", () => {
  const jd = [
    "Requirements",
    "- 5+ years with Kubernetes and Terraform",
    "- Strong Python",
    "- Managing data pipelines",
    "Nice to have",
    "- GraphQL",
  ].join("\n");

  const resume = [
    "Summary",
    "Platform engineer focused on k8s.",
    "Skills",
    "Python, Terraform, Docker",
    "Experience",
    "- Managed data pipelines processing 2TB a day in Python",
  ].join("\n");

  const result = matchResumeToJob(resume, jd);

  it("reports exact, variant and missing statuses", () => {
    expect(termOf(result, "Python")?.status).toBe("exact");
    expect(termOf(result, "Terraform")?.status).toBe("exact");
    expect(termOf(result, "Kubernetes")?.status).toBe("variant");
    expect(termOf(result, "Kubernetes")?.matchedForms).toEqual(["k8s"]);
    expect(termOf(result, "GraphQL")?.status).toBe("missing");
  });

  it("matches inflections as variants", () => {
    const pipelines = termOf(result, "data pipelines");
    expect(pipelines?.status).toBe("exact");
    const managed = matchResumeToJob("Managed vendors.", "Requirements\n- vendor management").terms[0];
    expect(managed.status).toBe("missing");
    const inflected = matchResumeToJob("I have built data pipeline tooling.", "Requirements\n- data pipelines").terms[0];
    expect(inflected.status).toBe("variant");
  });

  it("records every section a term was found in, in reading order", () => {
    expect(termOf(result, "Python")?.locations).toEqual(["skills", "experience"]);
    expect(termOf(result, "Python")?.count).toBe(2);
    expect(termOf(result, "Kubernetes")?.locations).toEqual(["summary"]);
  });

  it("does not count React Native as React", () => {
    const r = matchResumeToJob("Built apps in React Native.", "Requirements\n- React");
    expect(r.terms[0].status).toBe("missing");
  });

  it("computes weighted coverage with partial credit for variants", () => {
    const { coverage } = result;
    const totalWeight = result.terms.reduce((s, t) => s + t.weight, 0);
    const earned = result.terms.reduce((s, t) => s + t.weight * STATUS_CREDIT[t.status], 0);
    expect(coverage.weightedCoveragePct).toBe(Math.round((earned / totalWeight) * 100));
    expect(coverage.exactCount + coverage.variantCount + coverage.missingCount).toBe(result.terms.length);
    expect(coverage.requiredMissing).toEqual([]);
  });

  it("lists required terms that are missing, heaviest first", () => {
    const r = matchResumeToJob("Python developer.", "Requirements\n- Kubernetes\n- Kubernetes\n- Terraform\n- Python");
    expect(r.coverage.requiredMissing).toEqual(["Kubernetes", "Terraform"]);
  });

  it("matches candidate terms from the posting", () => {
    const terms = extractJdTerms("Requirements\n- FooDB experience");
    const r = matchTerms("Ran FooDB clusters.", terms);
    expect(r.terms[0]).toMatchObject({ term: "FooDB", status: "exact", source: "candidate" });
  });

  it("is case-insensitive for ordinary forms but not for protected ones", () => {
    expect(matchResumeToJob("PYTHON, terraform", "Requirements\n- Python\n- Terraform").coverage.missingCount).toBe(0);
    expect(matchResumeToJob("I excel at writing.", "Requirements\n- Excel").terms[0].status).toBe("missing");
  });

  it("returns null coverage when there are no terms", () => {
    expect(matchTerms("anything", []).coverage.weightedCoveragePct).toBeNull();
  });
});

describe("summarize", () => {
  it("weights coverage by term weight", () => {
    const t = (weight: number, status: TermMatch["status"]): TermMatch => ({
      term: String(weight),
      category: "hard",
      weight,
      required: true,
      status,
      locations: [],
      count: 0,
      matchedForms: [],
      source: "lexicon",
    });
    expect(summarize([t(3, "exact"), t(1, "missing")]).weightedCoveragePct).toBe(75);
    expect(summarize([t(1, "variant")]).weightedCoveragePct).toBe(80);
  });
});

describe("alternatives in the posting", () => {
  const jd = [
    "Requirements",
    "- Experience operating services on AWS (ECS or Kubernetes, RDS, S3)",
    "- End-to-end testing with Playwright/Cypress",
    "- Strong TypeScript and React",
  ].join("\n");

  it("links terms joined by 'or' or a slash", () => {
    const terms = extractJdTerms(jd);
    const k8s = terms.find((t) => t.term === "Kubernetes");
    const playwright = terms.find((t) => t.term === "Playwright");
    expect(k8s?.alternatives).toEqual(expect.arrayContaining([expect.stringMatching(/ECS/)]));
    expect(playwright?.alternatives).toContain("Cypress");
  });

  it("does not link comma lists or plain neighbours", () => {
    const terms = extractJdTerms(jd);
    expect(terms.find((t) => t.term === "TypeScript")?.alternatives).toBeUndefined();
    expect(terms.find((t) => t.term === "RDS" || /RDS/.test(t.term))?.alternatives ?? []).not.toContain("S3");
  });

  it("counts a term as covered when the resume shows an alternative", () => {
    const resume = "Skills\nTypeScript, React, AWS ECS, Cypress";
    const result = matchResumeToJob(resume, jd);
    const k8s = result.terms.find((t) => t.term === "Kubernetes");
    const playwright = result.terms.find((t) => t.term === "Playwright");
    expect(k8s?.status).not.toBe("missing");
    expect(k8s?.satisfiedBy).toMatch(/ECS/);
    expect(playwright?.satisfiedBy).toBe("Cypress");
    expect(result.coverage.requiredMissing).not.toContain("Kubernetes");
  });

  it("still reports both missing when the resume shows neither", () => {
    const result = matchResumeToJob("Skills\nTypeScript, React", jd);
    expect(result.terms.find((t) => t.term === "Playwright")?.status).toBe("missing");
    expect(result.terms.find((t) => t.term === "Cypress")?.status).toBe("missing");
  });
});
