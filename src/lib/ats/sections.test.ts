import { describe, expect, it } from "vitest";
import { classifyHeading, findSections, sectionLines } from "./sections";

describe("classifyHeading", () => {
  it.each([
    ["EXPERIENCE", "experience"],
    ["Professional Experience:", "experience"],
    ["Work History", "experience"],
    ["Education & Training", "education"],
    ["Technical Skills", "skills"],
    ["Skills: Python, SQL, Go", "skills"],
    ["Licenses & Certifications", "certifications"],
    ["Profile", "summary"],
    ["Selected Projects", "projects"],
    ["Volunteer Experience", "other"],
    ["E X P E R I E N C E", "experience"],
  ])("%s → %s", (line, canonical) => {
    expect(classifyHeading(line)?.canonical).toBe(canonical);
  });

  it("suggests standard names for creative headings", () => {
    expect(classifyHeading("My Journey")?.suggested).toBe("Experience");
    expect(classifyHeading("Toolbox")?.suggested).toBe("Skills");
    expect(classifyHeading("Things I've Built")?.suggested).toBe("Projects");
  });

  it("ignores bullets and sentences", () => {
    expect(classifyHeading("- Experience with React")).toBeNull();
    expect(classifyHeading("Five years of experience building APIs")).toBeNull();
  });
});

describe("findSections / sectionLines", () => {
  it("splits text into sections and returns a section's lines", () => {
    const lines = ["Name", "Experience", "Role A", "- did x", "Education", "School"];
    const sections = findSections(lines);
    expect(sections.map((s) => [s.canonical, s.line, s.endLine])).toEqual([
      ["experience", 1, 3],
      ["education", 4, 5],
    ]);
    expect(sectionLines(lines, sections, "experience")).toEqual(["Role A", "- did x"]);
  });
});
