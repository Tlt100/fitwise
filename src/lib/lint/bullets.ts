/**
 * Deterministic bullet linter. Scores each experience bullet against Google's
 * "Accomplished [X] as measured by [Y], by doing [Z]" shape: a strong verb, a
 * measurable result and a readable length.
 *
 * Advice never supplies numbers. It asks the user for their real figures and
 * leaves bracketed placeholders, because an invented metric on a resume is a
 * liability in an interview.
 */
import { classifyHeading, findSections, type CanonicalSection } from "@/lib/ats/sections";
import { findDateRanges } from "@/lib/ats/dates";
import { BUZZWORDS, WEAK_OPENERS, baseVerb } from "./verbs";

export type BulletFlagId =
  | "weak-opener"
  | "no-action-verb"
  | "no-metric"
  | "too-short"
  | "too-long"
  | "first-person"
  | "passive"
  | "repeated-verb"
  | "buzzword";

export type BulletFlag = {
  id: BulletFlagId;
  label: string;
  advice: string;
};

export type BulletLint = {
  /** Position among detected bullets (0-based). */
  index: number;
  /** 0-based line in the input text where the bullet starts. */
  line: number;
  text: string;
  words: number;
  /** 0–3: strong verb + measurable result + clean form. */
  score: number;
  /** Normalised opening verb when it is a recognised action verb. */
  verb?: string;
  flags: BulletFlag[];
  /** A fill-in-the-blanks rewrite shape. Placeholders are in [brackets]. */
  suggestion: string;
};

export type BulletLintReport = {
  bullets: BulletLint[];
  total: number;
  withMetric: number;
  withStrongVerb: number;
  /** Mean score, one decimal. 0 when there are no bullets. */
  averageScore: number;
  flagCounts: Partial<Record<BulletFlagId, number>>;
  /** e.g. "9 of 21 bullets show a measurable result." */
  summary: string;
  /** Indices of the five weakest bullets, weakest first. */
  weakestIndices: number[];
  /** "markers": bullets had glyphs or numbering; "inferred": found from sentence shape (e.g. DOCX lists). */
  detection: "markers" | "inferred" | "none";
  formula: string;
};

export const BULLET_FORMULA = "Accomplished [X] as measured by [Y], by doing [Z]";

const MARKER = /^\s*(?:[-*•▪◦‣➢➤►▸●○■□◆◇❖✓✔→·]|\d{1,2}[.)])\s+(\S.*)$/;
const SKIP_SECTIONS: CanonicalSection[] = ["skills", "education", "certifications"];
const SKIP_HEADINGS =
  /^(languages|interests|hobbies|coursework|relevant coursework|references|awards|honors|honors and awards|awards and honors|publications|patents|contact|contact information|affiliations|memberships|professional affiliations)$/;
const CONTINUES = /(?:,|;|\b(?:and|or|&|of|to|the|for|with|in|on|by|a|an|from|into|across|via|including))$/i;

const FLAG_TEXT: Record<BulletFlagId, { label: string; advice: string }> = {
  "weak-opener": {
    label: "Weak opener",
    advice:
      "Lead with what you did, not what you were assigned. Replace phrases like \"Responsible for\" or \"Helped\" with the verb for your part: Led, Built, Ran, Negotiated.",
  },
  "no-action-verb": {
    label: "No action verb",
    advice: "Start with a past-tense action verb that names your contribution (Designed, Reduced, Launched).",
  },
  "no-metric": {
    label: "No measurable result",
    advice:
      "Add the result as measured by a real number you can stand behind: time saved, revenue, error rate, users, volume. Use your own figure; if you do not have one, state the scale instead (team size, how often, how many). Do not estimate a number you cannot back up.",
  },
  "too-short": {
    label: "Too short",
    advice: "Under 8 words rarely says what changed. Add the outcome and how you achieved it.",
  },
  "too-long": {
    label: "Too long",
    advice: "Over 35 words gets skimmed. Keep one accomplishment per bullet and cut the background.",
  },
  "first-person": {
    label: "First person",
    advice: "Drop \"I\", \"my\" and \"we\". Resume bullets are written in implied first person: start with the verb.",
  },
  passive: {
    label: "Passive voice",
    advice: "Rewrite so you are the one acting: \"Reports were prepared\" becomes \"Prepared reports for…\".",
  },
  "repeated-verb": {
    label: "Repeated opening verb",
    advice: "Several bullets open with the same verb. Vary it so each bullet reads as a distinct accomplishment.",
  },
  buzzword: {
    label: "Buzzword",
    advice: "Replace self-descriptions (\"results-driven\", \"team player\") with the evidence that shows it.",
  },
};

function flag(id: BulletFlagId): BulletFlag {
  return { id, ...FLAG_TEXT[id] };
}

function wordCount(s: string): number {
  return s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-/%$]*/gu)?.length ?? 0;
}

type RawBullet = { line: number; text: string };

function sectionOfLine(lines: string[]): Array<{ canonical: CanonicalSection | null; key: string }> {
  const sections = findSections(lines);
  const out: Array<{ canonical: CanonicalSection | null; key: string }> = lines.map(() => ({
    canonical: null,
    key: "",
  }));
  for (const s of sections) {
    const key = s.text.toLowerCase().replace(/[^a-z& ]/g, "").replace(/&/g, "and").trim();
    for (let i = s.line; i <= s.endLine; i++) out[i] = { canonical: s.canonical, key };
  }
  return out;
}

function inSkippedSection(info: { canonical: CanonicalSection | null; key: string }): boolean {
  if (info.canonical && SKIP_SECTIONS.includes(info.canonical)) return true;
  return info.canonical === "other" && SKIP_HEADINGS.test(info.key);
}

/** A comma-separated list of tools reads as a bullet but is not an accomplishment. */
function looksLikeList(text: string): boolean {
  const commas = (text.match(/,/g) ?? []).length;
  const first = text.split(/\s+/)[0] ?? "";
  return commas >= 3 && !baseVerb(first) && wordCount(text) <= 20;
}

function collectMarkerBullets(lines: string[]): RawBullet[] {
  const out: RawBullet[] = [];
  let current: RawBullet | null = null;
  lines.forEach((line, i) => {
    const m = MARKER.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { line: i, text: m[1].trim() };
      return;
    }
    const trimmed = line.trim();
    if (
      current &&
      trimmed &&
      !classifyHeading(trimmed) &&
      findDateRanges([trimmed]).length === 0 &&
      (/^[a-z(]/.test(trimmed) ||
        CONTINUES.test(current.text) ||
        // "…lifting conversion / 18% for 2M shoppers": a figure continuing an unfinished sentence.
        (/^[\d$€£%]/.test(trimmed) && !/[.!?]$/.test(current.text)))
    ) {
      // A wrapped bullet: PDF text layers break long bullets into visual lines.
      current.text = `${current.text} ${trimmed}`;
      return;
    }
    if (current) out.push(current);
    current = null;
  });
  if (current) out.push(current);
  return out;
}

/**
 * Fallback when there are no bullet glyphs (mammoth's raw text drops list
 * markers): sentence-shaped lines that open with a verb or weak opener.
 */
function collectInferredBullets(lines: string[]): RawBullet[] {
  const out: RawBullet[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || classifyHeading(t) || findDateRanges([t]).length > 0) return;
    if (wordCount(t) < 5) return;
    const first = t.split(/\s+/)[0] ?? "";
    const lower = t.toLowerCase();
    if (baseVerb(first) || WEAK_OPENERS.some((w) => lower.startsWith(`${w} `))) {
      out.push({ line: i, text: t });
    }
  });
  return out;
}

const YEAR_ONLY = /\b(?:19|20)\d{2}\b/g;
const ALNUM_CODE = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g; // S3, EC2, HTML5, Q3
const NUMBER_WORDS =
  /\b(?:doubled|tripled|quadrupled|halved|tenfold|twofold|dozens?|hundreds|thousands|millions?|billions?|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|twice|half)\b/i;

export function hasMetric(text: string): boolean {
  const stripped = text.replace(YEAR_ONLY, " ").replace(ALNUM_CODE, " ");
  return /\d|%|\$|€|£|¥|₹/.test(stripped) || NUMBER_WORDS.test(stripped);
}

const FIRST_PERSON = /(?<![\w/])(?:I|I'm|I've|I'd|I'll)(?![\w/])|\b(?:me|my|mine|myself|we|We|our|Our|ours|us)\b/;
const PASSIVE =
  /\b(?:was|were|been|being|is|are|got)\s+(?:\w+ly\s+)?(?:\w{3,}ed|built|led|made|done|given|taken|written|run|sent|held|brought|chosen|known|shown|seen|grown|drawn|won|sold|taught)\b/i;

function weakOpener(text: string): string | null {
  const lower = text.toLowerCase();
  for (const w of WEAK_OPENERS) {
    if (lower === w || lower.startsWith(`${w} `) || lower.startsWith(`${w},`)) return w;
  }
  return null;
}

function suggestVerbs(text: string): string[] {
  const t = text.toLowerCase();
  if (/\b(manag|supervis|team|staff|lead)/.test(t)) return ["Led", "Directed", "Managed"];
  if (/\b(develop|build|code|app|software|api|website|feature|system)/.test(t)) return ["Built", "Engineered", "Shipped"];
  if (/\b(sale|client|customer|account)/.test(t)) return ["Grew", "Won", "Retained"];
  if (/\b(report|analy|data|research)/.test(t)) return ["Analyzed", "Identified", "Forecasted"];
  if (/\b(process|workflow|operation|efficien)/.test(t)) return ["Streamlined", "Automated", "Reduced"];
  if (/\b(social|post|content|campaign|brand|newsletter|blog)/.test(t)) return ["Created", "Published", "Grew"];
  if (/\b(event|project|schedule|plan)/.test(t)) return ["Organized", "Coordinated", "Delivered"];
  return ["Led", "Delivered", "Improved"];
}

function buildSuggestion(text: string, flags: BulletFlagId[], verb?: string): string {
  const opener = weakOpener(text);
  let rest = text;
  if (opener) rest = text.slice(opener.length).trim();
  else if (verb) rest = text.split(/\s+/).slice(1).join(" ");
  rest = rest.replace(/[.;]+$/, "").replace(/^(?:the|a|an)\s+/i, "the ");

  const verbs = verb && !opener ? [verb[0].toUpperCase() + verb.slice(1)] : suggestVerbs(text);
  const lead = verbs[0];
  const parts = [`${lead} ${rest || "[what you accomplished]"}`.trim()];
  if (flags.includes("no-metric")) parts.push("as measured by [your real result — a number you can verify]");
  if (!/\bby\s+\w+ing\b|\busing\b|\bthrough\b|\bvia\b/i.test(text)) parts.push("by [how you did it]");
  const shape = parts.join(", ");
  const alternatives = verb && !opener ? "" : ` (or start with ${verbs.slice(1).join(" / ")})`;
  return `Try: "${shape}."${alternatives}`;
}

export function lintBullet(text: string, index = 0, line = 0): BulletLint {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = wordCount(clean);
  const flags: BulletFlagId[] = [];

  const opener = weakOpener(clean);
  const firstWord = clean.split(" ")[0] ?? "";
  const verb = opener ? undefined : baseVerb(firstWord) ?? undefined;
  if (opener) flags.push("weak-opener");
  else if (!verb) flags.push("no-action-verb");

  const metric = hasMetric(clean);
  if (!metric) flags.push("no-metric");
  if (words < 8) flags.push("too-short");
  if (words > 35) flags.push("too-long");
  if (FIRST_PERSON.test(clean)) flags.push("first-person");
  if (PASSIVE.test(clean)) flags.push("passive");
  const lower = clean.toLowerCase();
  if (BUZZWORDS.some((b) => new RegExp(`(?:^|[^\\w-])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\w-])`, "i").test(lower))) {
    flags.push("buzzword");
  }

  const form =
    words >= 8 &&
    words <= 35 &&
    !flags.includes("first-person") &&
    !flags.includes("passive") &&
    !flags.includes("buzzword");
  const score = (verb ? 1 : 0) + (metric ? 1 : 0) + (form ? 1 : 0);

  return {
    index,
    line,
    text: clean,
    words,
    score,
    verb,
    flags: flags.map(flag),
    suggestion: score === 3 ? "" : buildSuggestion(clean, flags, verb),
  };
}

export function lintBullets(text: string): BulletLintReport {
  const lines = text.split("\n");
  const sections = sectionOfLine(lines);

  let detection: BulletLintReport["detection"] = "markers";
  let raw = collectMarkerBullets(lines);
  if (raw.filter((b) => !inSkippedSection(sections[b.line])).length < 3) {
    const inferred = collectInferredBullets(lines);
    if (inferred.length > raw.length) {
      raw = inferred;
      detection = "inferred";
    }
  }
  raw = raw.filter((b) => !inSkippedSection(sections[b.line]) && !looksLikeList(b.text));
  if (raw.length === 0) detection = "none";

  const bullets = raw.map((b, i) => lintBullet(b.text, i, b.line));

  // Repeated opening verbs: the first two uses are fine, later ones get flagged.
  const seen = new Map<string, number>();
  for (const b of bullets) {
    if (!b.verb) continue;
    const n = (seen.get(b.verb) ?? 0) + 1;
    seen.set(b.verb, n);
    if (n > 2) b.flags.push(flag("repeated-verb"));
  }

  const total = bullets.length;
  const withMetric = bullets.filter((b) => !b.flags.some((f) => f.id === "no-metric")).length;
  const withStrongVerb = bullets.filter((b) => b.verb).length;
  const flagCounts: Partial<Record<BulletFlagId, number>> = {};
  for (const b of bullets) for (const f of b.flags) flagCounts[f.id] = (flagCounts[f.id] ?? 0) + 1;
  const averageScore = total ? Math.round((bullets.reduce((s, b) => s + b.score, 0) / total) * 10) / 10 : 0;

  const summary =
    total === 0
      ? "No bullet points were detected. Recruiters and ATS both read bulleted accomplishments more reliably than paragraphs."
      : `${withMetric} of ${total} bullet${total === 1 ? "" : "s"} show${total === 1 ? "s" : ""} a measurable result; ${withStrongVerb} open${withStrongVerb === 1 ? "s" : ""} with a strong action verb.`;

  const report: BulletLintReport = {
    bullets,
    total,
    withMetric,
    withStrongVerb,
    averageScore,
    flagCounts,
    summary,
    weakestIndices: [],
    detection,
    formula: BULLET_FORMULA,
  };
  report.weakestIndices = weakest(report, 5).map((b) => b.index);
  return report;
}

/** The n lowest-scoring bullets, weakest first; ties broken by flag count, then position. */
export function weakest(report: Pick<BulletLintReport, "bullets">, n = 5): BulletLint[] {
  return [...report.bullets]
    .filter((b) => b.score < 3 || b.flags.length > 0)
    .sort((a, b) => a.score - b.score || b.flags.length - a.flags.length || a.index - b.index)
    .slice(0, n);
}
