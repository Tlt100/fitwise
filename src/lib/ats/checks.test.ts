import { describe, expect, it } from "vitest";
import { emptyLayoutHints, type ExtractMeta } from "@/lib/extract/types";
import { groupChecks, runAtsChecks } from "./checks";
import type { AtsReport } from "./types";
import {
  CREATIVE_HEADINGS_RESUME,
  GOOD_RESUME,
  INCONSISTENT_DATES_RESUME,
  INJECTION_RESUME,
  NO_CONTACT_RESUME,
  TWO_COLUMN_GARBLED,
} from "./__fixtures__/resumes";

const NOW = new Date("2026-10-01T00:00:00Z");

function check(report: AtsReport, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}; have ${report.checks.map((c) => c.id).join(", ")}`);
  return found;
}

const pdfMeta = (overrides: Partial<ExtractMeta> = {}): ExtractMeta => ({
  kind: "pdf",
  pages: 1,
  pagesProcessed: 1,
  layoutHints: emptyLayoutHints(),
  ...overrides,
});

describe("runAtsChecks — a clean, single-column resume", () => {
  const report = runAtsChecks(GOOD_RESUME, pdfMeta(), NOW);

  it("scores as low risk with no failures", () => {
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.risk).toBe("low");
    expect(report.checks.filter((c) => c.severity === "fail")).toEqual([]);
    expect(report.suspectedInjection).toBe(false);
  });

  it("finds every contact detail", () => {
    for (const id of ["contact.email", "contact.phone", "contact.linkedin", "contact.links", "contact.location"]) {
      expect(check(report, id).severity).toBe("pass");
    }
  });

  it("recognises all standard sections", () => {
    expect(report.stats.sectionsFound).toEqual(
      expect.arrayContaining(["Experience", "Education", "Skills", "Summary", "Projects", "Certifications"]),
    );
  });

  it("estimates experience and reports consistent dates", () => {
    expect(check(report, "dates.consistent").severity).toBe("pass");
    // Jan 2017 → Oct 2026, with no gaps.
    expect(report.stats.experience.years).toBe(10);
    expect(report.stats.experience.source).toBe("experience-section");
  });

  it("counts bullets and gives every check a penalty consistent with its severity", () => {
    expect(report.stats.bulletCount).toBe(10);
    for (const c of report.checks) {
      if (c.severity === "pass") expect(c.penalty).toBe(0);
      else expect(c.penalty).toBeGreaterThan(0);
      if (c.severity !== "pass") expect(c.fix).toBeTruthy();
    }
    expect(report.score).toBe(Math.round(100 - report.checks.reduce((s, c) => s + c.penalty, 0)));
  });
});

describe("runAtsChecks — layout failures", () => {
  it("fails a garbled two-column extraction even without PDF position data", () => {
    const report = runAtsChecks(TWO_COLUMN_GARBLED, undefined, NOW);
    expect(check(report, "layout.columns").severity).toBe("fail");
    expect(check(report, "contact.email").severity).toBe("fail");
    expect(report.risk).toBe("high");
  });

  it("fails when the PDF extractor detected columns", () => {
    const report = runAtsChecks(
      GOOD_RESUME,
      pdfMeta({ layoutHints: { ...emptyLayoutHints(), likelyMultiColumn: true, multiColumnPages: [1] } }),
      NOW,
    );
    const columns = check(report, "layout.columns");
    expect(columns.severity).toBe("fail");
    expect(columns.detail).toContain("page 1");
    expect(report.score).toBeLessThan(85);
  });

  it("flags DOCX tables, text boxes and header-only contact details", () => {
    const withoutContact = GOOD_RESUME.replace(/^Austin.*$/m, "Austin, TX");
    const report = runAtsChecks(
      withoutContact,
      {
        kind: "docx",
        hasTables: true,
        tableCount: 2,
        tableTextRatio: 0.6,
        headerFooterText: "jordan.rivera@example.com | (512) 555-0142",
        layoutHints: { ...emptyLayoutHints(), textBoxes: 1 },
      },
      NOW,
    );
    expect(check(report, "layout.tables").severity).toBe("fail");
    expect(check(report, "layout.text-boxes").severity).toBe("warn");
    const email = check(report, "contact.email");
    expect(email.severity).toBe("fail");
    expect(email.title).toMatch(/header or footer/);
    expect(check(report, "contact.phone").title).toMatch(/header or footer/);
    expect(check(report, "format.kind").title).toBe("DOCX");
  });

  it("treats a light table as a warning, not a failure", () => {
    const report = runAtsChecks(
      GOOD_RESUME,
      { kind: "docx", hasTables: true, tableCount: 1, tableTextRatio: 0.05, layoutHints: emptyLayoutHints() },
      NOW,
    );
    expect(check(report, "layout.tables").severity).toBe("warn");
  });

  it("flags image-only pages and icon glyphs", () => {
    const report = runAtsChecks(
      GOOD_RESUME,
      pdfMeta({ pages: 2, layoutHints: { ...emptyLayoutHints(), imageOnlyPages: [2], privateUseGlyphs: 4 } }),
      NOW,
    );
    expect(check(report, "layout.image-pages").severity).toBe("fail");
    expect(check(report, "layout.glyphs").severity).toBe("warn");
    expect(check(report, "format.kind").title).toMatch(/scanned/);
  });

  it("fails on many unmapped glyphs (broken font encoding)", () => {
    const report = runAtsChecks(`${GOOD_RESUME}\n${"(cid:72)".repeat(20)}`, undefined, NOW);
    expect(check(report, "layout.glyphs").severity).toBe("fail");
  });

  it("notes when only some PDF pages were checked", () => {
    const report = runAtsChecks(GOOD_RESUME, pdfMeta({ pages: 12, pagesProcessed: 8 }), NOW);
    expect(check(report, "format.kind").detail).toContain("first 8 of 12");
  });
});

describe("runAtsChecks — contact", () => {
  it("fails a resume with no email and warns on phone and LinkedIn", () => {
    const report = runAtsChecks(NO_CONTACT_RESUME, undefined, NOW);
    expect(check(report, "contact.email").severity).toBe("fail");
    expect(check(report, "contact.phone").severity).toBe("warn");
    expect(check(report, "contact.linkedin").severity).toBe("warn");
  });

  it("warns when contact details only appear at the end (footer-like)", () => {
    const moved = GOOD_RESUME.replace(/^Austin.*$/m, "Austin, TX") + "\njordan.rivera@example.com | (512) 555-0142\n";
    const report = runAtsChecks(moved, undefined, NOW);
    expect(check(report, "contact.late").severity).toBe("warn");
  });

  it("does not demand GitHub from a non-technical resume", () => {
    const report = runAtsChecks(NO_CONTACT_RESUME, undefined, NOW);
    expect(report.checks.find((c) => c.id === "contact.links")).toBeUndefined();
  });
});

describe("runAtsChecks — sections and dates", () => {
  it("flags creative and letter-spaced headings with a standard replacement", () => {
    const report = runAtsChecks(CREATIVE_HEADINGS_RESUME, undefined, NOW);
    const experience = check(report, "sections.experience");
    expect(experience.severity).toBe("warn");
    expect(experience.detail).toContain("My Journey");
    expect(check(report, "sections.skills").detail).toContain("What I Bring");
    expect(check(report, "sections.creative").fix).toContain('Rename "Who I Am" to "Summary"');
    expect(check(report, "sections.letter-spaced").severity).toBe("warn");
    // The letter-spaced heading still counts as Education.
    expect(check(report, "sections.education").severity).toBe("pass");
  });

  it("fails when there is no Experience heading at all", () => {
    const report = runAtsChecks(GOOD_RESUME.replace(/^Experience$/m, ""), undefined, NOW);
    expect(check(report, "sections.experience").severity).toBe("fail");
  });

  it("flags mixed date formats, 'Current' and undated roles", () => {
    const report = runAtsChecks(INCONSISTENT_DATES_RESUME, undefined, NOW);
    const consistent = check(report, "dates.consistent");
    expect(consistent.severity).toBe("warn");
    expect(consistent.detail).toMatch(/3 different ways/);
    expect(check(report, "dates.present").detail).toContain('"current"');
    const undated = check(report, "dates.undated-roles");
    expect(undated.detail).toContain("Marketing Intern, Northside Gallery");
  });

  it("does not count year-only education dates as inconsistent", () => {
    // Experience uses months; education uses years only — normal and fine.
    const report = runAtsChecks(NO_CONTACT_RESUME, undefined, NOW);
    expect(check(report, "dates.consistent").severity).toBe("pass");
  });

  it("fails when there are no dates at all", () => {
    const report = runAtsChecks("Jane Doe\njane@example.com\nExperience\nEngineer at Acme\n- Built things", undefined, NOW);
    expect(check(report, "dates.found").severity).toBe("fail");
  });
});

describe("runAtsChecks — integrity", () => {
  it("fails and sets suspectedInjection for instructions aimed at an AI", () => {
    const report = runAtsChecks(INJECTION_RESUME, undefined, NOW);
    expect(report.suspectedInjection).toBe(true);
    const injection = check(report, "integrity.injection");
    expect(injection.severity).toBe("fail");
    expect(injection.detail).toMatch(/Ignore all previous instructions/i);
    expect(report.risk).not.toBe("low");
  });

  it("fails on high-confidence hidden text from the extractor", () => {
    const report = runAtsChecks(
      GOOD_RESUME,
      pdfMeta({
        hiddenTextFlags: [
          { reason: "white-text", page: 1, chars: 60, sample: "kubernetes terraform golang rust kafka spark airflow snowflake", confidence: "high" },
        ],
      }),
      NOW,
    );
    expect(check(report, "integrity.hidden-text").severity).toBe("fail");
    expect(report.suspectedInjection).toBe(true);
  });

  it("passes low-confidence white text (a banner) without penalty", () => {
    const report = runAtsChecks(
      GOOD_RESUME,
      pdfMeta({ hiddenTextFlags: [{ reason: "white-text", page: 1, chars: 13, sample: "Jordan Rivera", confidence: "low" }] }),
      NOW,
    );
    expect(check(report, "integrity.low-contrast").severity).toBe("pass");
    expect(report.suspectedInjection).toBe(false);
  });

  it("reports a clean integrity row otherwise", () => {
    expect(check(runAtsChecks(GOOD_RESUME, undefined, NOW), "integrity.clean").severity).toBe("pass");
  });
});

describe("groupChecks", () => {
  it("groups in display order with integrity first", () => {
    const groups = groupChecks(runAtsChecks(GOOD_RESUME, undefined, NOW));
    expect(groups[0].category).toBe("integrity");
    expect(groups.map((g) => g.category)).toEqual(["integrity", "contact", "sections", "dates", "layout", "length", "format"]);
  });
});
