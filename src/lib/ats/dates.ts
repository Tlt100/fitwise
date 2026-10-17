/**
 * Date range parsing for resumes: "Jan 2020 - Present", "03/2019 – 06/2021",
 * "2018 to 2020", "Summer 2022". Deterministic and tolerant; anything it cannot
 * read is simply not counted.
 */
import type { YearsEstimate } from "./types";
import { findSections, sectionLines } from "./sections";

export type DateFormat = "month-name" | "numeric" | "iso" | "year" | "season";

export type DateToken = {
  format: DateFormat;
  year: number;
  /** 1–12. Year-only tokens use 1 for a start and 1 for an end (see toMonths). */
  month: number;
  raw: string;
};

export type DateRange = {
  start: DateToken;
  end: DateToken | "present";
  /** How "present" was written, e.g. "Present", "Current", "Now". */
  presentWord?: string;
  line: number;
  raw: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const SEASONS: Record<string, number> = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

const MONTH_NAME =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "(?:19[5-9]\\d|20[0-4]\\d)";
const TOKEN =
  `(?:${MONTH_NAME}\\.?,?\\s*'?(?:${YEAR}|\\d{2})` + // Jan 2020, Jan. 2020, Jan '20
  `|(?:spring|summer|fall|autumn|winter)\\s+${YEAR}` +
  `|(?:0?[1-9]|1[0-2])\\s*[/.]\\s*${YEAR}` + // 01/2020, 1.2020
  `|${YEAR}\\s*[-/.]\\s*(?:0[1-9]|1[0-2])(?![\\d])` + // 2020-01
  `|${YEAR})`;
const PRESENT = "(present|current(?:ly)?|now|today|to date|ongoing|till date)";
const SEP = "\\s*(?:-|–|—|to|through|thru|until|till|~)\\s*";

const RANGE = new RegExp(`(${TOKEN})${SEP}(?:(${TOKEN})|${PRESENT})(?![\\w/])`, "gi");

export function parseDateToken(raw: string): DateToken | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^(${MONTH_NAME})\\.?,? ?'?(\\d{4}|\\d{2})$`).exec(s))) {
    const month = MONTHS[m[1].replace(".", "")] ?? MONTHS[m[1].slice(0, 3)];
    let year = Number(m[2]);
    if (m[2].length === 2) year += year > 50 ? 1900 : 2000;
    return { format: "month-name", year, month, raw };
  }
  if ((m = /^(spring|summer|fall|autumn|winter) (\d{4})$/.exec(s))) {
    return { format: "season", year: Number(m[2]), month: SEASONS[m[1]], raw };
  }
  if ((m = /^(\d{1,2}) ?[/.] ?(\d{4})$/.exec(s))) {
    return { format: "numeric", year: Number(m[2]), month: Number(m[1]), raw };
  }
  if ((m = /^(\d{4}) ?[-/.] ?(\d{2})$/.exec(s))) {
    return { format: "iso", year: Number(m[1]), month: Number(m[2]), raw };
  }
  if ((m = /^(\d{4})$/.exec(s))) {
    return { format: "year", year: Number(m[1]), month: 1, raw };
  }
  return null;
}

export function findDateRanges(lines: string[]): DateRange[] {
  const ranges: DateRange[] = [];
  lines.forEach((line, index) => {
    RANGE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RANGE.exec(line))) {
      const start = parseDateToken(m[1]);
      if (!start) continue;
      if (m[2]) {
        const end = parseDateToken(m[2]);
        if (!end) continue;
        // "2019 - 2020" is a range; "555-1234"-style noise never parses as years.
        ranges.push({ start, end, line: index, raw: m[0].trim() });
      } else if (m[3]) {
        ranges.push({ start, end: "present", presentWord: m[3], line: index, raw: m[0].trim() });
      }
    }
  });
  return ranges;
}

/** Any single date token on a line (used to tell dated from undated roles). */
export function lineHasDate(line: string): boolean {
  return new RegExp(`(?:^|[^\\d])(${TOKEN})(?![\\d])|\\b${PRESENT}\\b`, "i").test(line);
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** [startMonth, endMonthExclusive] as absolute month indices. */
export function rangeToMonths(range: DateRange, now: Date): [number, number] {
  const start = monthIndex(range.start.year, range.start.month);
  let end: number;
  if (range.end === "present") {
    end = monthIndex(now.getFullYear(), now.getMonth() + 1) + 1;
  } else if (range.end.format === "year") {
    // "2018 - 2020" — count to the start of the end year, which neither
    // inflates nor ignores it; a same-year range counts as half a year.
    end = range.start.format === "year" && range.end.year === range.start.year
      ? start + 6
      : monthIndex(range.end.year, 1);
  } else {
    end = monthIndex(range.end.year, range.end.month) + 1; // inclusive end month
  }
  return [start, end];
}

/** Sum of month intervals with overlaps merged, so concurrent roles are not double-counted. */
export function mergedMonths(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of sorted) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) {
      curEnd = b;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/**
 * Estimate total years of professional experience from date ranges. Uses the
 * Experience section when one is found, otherwise every range in the text
 * except those under Education.
 */
export function estimateYearsExperience(text: string, now: Date = new Date()): YearsEstimate {
  const lines = text.split("\n");
  const sections = findSections(lines);
  const experience = sectionLines(lines, sections, "experience");

  let source: YearsEstimate["source"] = "experience-section";
  let ranges = findDateRanges(experience);
  if (ranges.length === 0) {
    source = "whole-text";
    const educationLines = new Set<number>();
    for (const s of sections) {
      if (s.canonical === "education") {
        for (let i = s.line; i <= s.endLine; i++) educationLines.add(i);
      }
    }
    ranges = findDateRanges(lines).filter((r) => !educationLines.has(r.line));
  }

  const nowIndex = monthIndex(now.getFullYear(), now.getMonth() + 1) + 1;
  const intervals = ranges
    .map((r) => rangeToMonths(r, now))
    // Clamp future end dates ("expected 2027") to today.
    .map(([a, b]) => [a, Math.min(b, nowIndex)] as [number, number]);
  const months = mergedMonths(intervals);

  if (ranges.length === 0) {
    return { years: null, months: 0, rangeCount: 0, source };
  }
  const earliestStart = Math.min(...intervals.map(([a]) => a));
  const year = Math.floor(earliestStart / 12);
  const month = (earliestStart % 12) + 1;
  return {
    years: Math.round((months / 12) * 2) / 2,
    months,
    rangeCount: ranges.length,
    earliest: `${year}-${String(month).padStart(2, "0")}`,
    source,
  };
}
