export type AtsCategory =
  | "contact"
  | "sections"
  | "dates"
  | "layout"
  | "length"
  | "format"
  | "integrity";

export type AtsSeverity = "pass" | "warn" | "fail";

export type AtsCheck = {
  /** Stable identifier, e.g. "contact.email". */
  id: string;
  category: AtsCategory;
  severity: AtsSeverity;
  title: string;
  detail: string;
  /** What to do about it. Present on warn/fail rows. */
  fix?: string;
  /** Points deducted from 100 by this row (0 for a pass). */
  penalty: number;
};

export type YearsEstimate = {
  /** Total years of experience, overlaps merged, rounded to 0.5. Null when no ranges were found. */
  years: number | null;
  months: number;
  /** Date ranges used for the estimate. */
  rangeCount: number;
  /** "YYYY-MM" of the earliest start. */
  earliest?: string;
  /** Whether the estimate came from an Experience section or the whole text. */
  source: "experience-section" | "whole-text";
};

export type AtsStats = {
  words: number;
  characters: number;
  lines: number;
  estimatedPages: number;
  bulletCount: number;
  /** Share of words (0–1) that sit in paragraphs longer than 60 words. */
  longParagraphRatio: number;
  sectionsFound: string[];
  /** Date formats seen across date ranges, e.g. { "month-name": 6, "numeric": 1 }. */
  dateFormats: Record<string, number>;
  experience: YearsEstimate;
};

export type InjectionMatch = {
  /** Which rule matched, e.g. "ignore-instructions". */
  rule: string;
  /** The matched text with a little context. */
  snippet: string;
  strength: "strong" | "weak";
  /** True when the match sits inside text flagged as hidden. */
  inHiddenText: boolean;
};

export type InjectionReport = {
  suspectedInjection: boolean;
  matches: InjectionMatch[];
  /** Characters of high-confidence hidden text. */
  hiddenTextChars: number;
  /** Short samples of hidden text, for display and for telling the analyzer what to ignore. */
  hiddenSamples: string[];
};

export type AtsReport = {
  /** 0–100; 100 means no parse risks were found. */
  score: number;
  /** "low" ≥ 80, "medium" ≥ 55, else "high" parse risk. */
  risk: "low" | "medium" | "high";
  checks: AtsCheck[];
  stats: AtsStats;
  /**
   * True when the resume appears to carry instructions aimed at an AI screener
   * or a meaningful amount of hidden text. The analyze step should be told to
   * treat that text as untrusted content, not instructions.
   */
  suspectedInjection: boolean;
  integrity: InjectionReport;
};

export const ATS_CATEGORY_LABELS: Record<AtsCategory, string> = {
  contact: "Contact details",
  sections: "Section headings",
  dates: "Dates",
  layout: "Layout",
  length: "Length",
  format: "File format",
  integrity: "Integrity",
};

export const ATS_CATEGORY_ORDER: AtsCategory[] = [
  "integrity",
  "contact",
  "sections",
  "dates",
  "layout",
  "length",
  "format",
];
