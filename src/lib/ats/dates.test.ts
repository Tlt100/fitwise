import { describe, expect, it } from "vitest";
import { estimateYearsExperience, findDateRanges, lineHasDate, mergedMonths, parseDateToken } from "./dates";

const NOW = new Date("2026-10-01T00:00:00Z");

describe("parseDateToken", () => {
  it.each([
    ["Jan 2020", "month-name", 2020, 1],
    ["September 2019", "month-name", 2019, 9],
    ["Sept. 2019", "month-name", 2019, 9],
    ["Mar '21", "month-name", 2021, 3],
    ["03/2018", "numeric", 2018, 3],
    ["2020-07", "iso", 2020, 7],
    ["2016", "year", 2016, 1],
    ["Summer 2022", "season", 2022, 6],
  ])("%s", (raw, format, year, month) => {
    expect(parseDateToken(raw)).toMatchObject({ format, year, month });
  });

  it("rejects non-dates", () => {
    expect(parseDateToken("hello")).toBeNull();
  });
});

describe("findDateRanges", () => {
  it("reads common range shapes and present words", () => {
    const ranges = findDateRanges([
      "Engineer, Acme | Jan 2020 - Present",
      "03/2018 - 12/2019",
      "2014 to 2016",
      "Intern (Summer 2013 - Fall 2013)",
      "Lead, Foo  Feb 2021 – Current",
    ]);
    expect(ranges).toHaveLength(5);
    expect(ranges[0].end).toBe("present");
    expect(ranges[4].presentWord?.toLowerCase()).toBe("current");
  });

  it("does not read phone numbers or plain numbers as ranges", () => {
    expect(findDateRanges(["(512) 555-0142", "Reduced cost by 2000-3000 USD", "Increased 40 - 60%"])).toHaveLength(0);
  });

  it("detects single dates on a line", () => {
    expect(lineHasDate("Acme Corp, May 2019")).toBe(true);
    expect(lineHasDate("Acme Corp, Austin")).toBe(false);
  });
});

describe("mergedMonths", () => {
  it("merges overlapping intervals", () => {
    expect(mergedMonths([[0, 12], [6, 18], [24, 30]])).toBe(24);
  });
});

describe("estimateYearsExperience", () => {
  it("merges concurrent roles instead of double counting", () => {
    const text = `Experience
Engineer, Acme
Jan 2018 - Dec 2021
Freelance Consultant
Jan 2019 - Dec 2020
Education
B.S. Math
2010 - 2014`;
    const estimate = estimateYearsExperience(text, NOW);
    expect(estimate.years).toBe(4);
    expect(estimate.rangeCount).toBe(2);
    expect(estimate.earliest).toBe("2018-01");
  });

  it("runs Present ranges up to today", () => {
    const estimate = estimateYearsExperience("Experience\nAnalyst\nOct 2024 - Present", NOW);
    expect(estimate.years).toBe(2);
  });

  it("falls back to the whole text but skips education when there is no Experience heading", () => {
    const text = `Acme Corp, Analyst, Jun 2020 - Jun 2022
Education
State University 2014 - 2018`;
    const estimate = estimateYearsExperience(text, NOW);
    expect(estimate.source).toBe("whole-text");
    expect(estimate.years).toBe(2);
  });

  it("returns null when no ranges are found", () => {
    expect(estimateYearsExperience("No dates here", NOW).years).toBeNull();
  });

  it("clamps future end dates to today", () => {
    const estimate = estimateYearsExperience("Experience\nEngineer\nJan 2025 - Dec 2030", NOW);
    expect(estimate.years).toBeLessThanOrEqual(2);
  });
});
