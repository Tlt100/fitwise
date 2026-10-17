/**
 * ATS parse-risk report. Every check here is deterministic and runs without an
 * API key. The heaviest penalties go to what actually breaks real ATS parsers:
 * multi-column layouts, tables and text boxes, contact details in headers or
 * footers, non-standard headings, and unreadable or inconsistent dates.
 */
import { emptyLayoutHints, type ExtractMeta } from "@/lib/extract/types";
import { countGlyphHints } from "@/lib/extract/glyphs";
import { countWords } from "@/lib/extract/normalize";
import { estimateYearsExperience, findDateRanges, lineHasDate, type DateFormat } from "./dates";
import { detectInjection } from "./injection";
import { findSections, type CanonicalSection } from "./sections";
import { ATS_CATEGORY_ORDER, type AtsCategory, type AtsCheck, type AtsReport, type AtsSeverity, type AtsStats } from "./types";

export type { AtsReport, AtsCheck } from "./types";
export { estimateYearsExperience } from "./dates";

type Draft = Omit<AtsCheck, "penalty"> & { weight: number };

const PENALTY_SHARE: Record<AtsSeverity, number> = { pass: 0, warn: 0.4, fail: 1 };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/;
const LINKEDIN = /linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%-]+/i;
const GITHUB = /github\.com\/[A-Za-z0-9_-]+/i;
const PORTFOLIO =
  /\b(?:https?:\/\/)?(?:www\.)?(?![\w.-]*(?:linkedin|github|gmail|yahoo|outlook|hotmail|icloud)\.)[a-z0-9-]+\.(?:com|io|dev|me|net|org|co|design|app|site|xyz|tech|page|portfolio|ai)(?:\/[^\s]*)?\b/i;
const LOCATION =
  /\b[A-Z][a-zA-Z.\- ]{1,30},\s*(?:[A-Z]{2}\b|[A-Z][a-z]+)|\b\d{5}(?:-\d{4})?\b|\b(?:remote|hybrid)\b|\b(?:open to relocation|willing to relocate)\b/i;
const TECH = /\b(?:software|developer|engineer(?:ing)?|programmer|data scien|machine learning|devops|frontend|front-end|backend|back-end|full[- ]stack|python|javascript|typescript|java\b|react|kubernetes|aws)\b/i;
const ROLE_WORDS =
  /\b(?:engineer|developer|manager|analyst|designer|intern|lead|director|consultant|specialist|coordinator|associate|assistant|officer|scientist|administrator|architect|technician|representative|teacher|nurse|accountant|advisor|supervisor|executive|programmer|researcher|editor|writer|strategist|producer|owner|founder|president|vp|head of|tutor|instructor|clerk|cashier|server|agent)\b/i;
const BULLET_LINE = /^\s*(?:[-*•▪◦‣➢➤►▸●○■□◆◇❖✓✔→·]|\d{1,2}[.)])\s+\S/;

function finalize(drafts: Draft[]): AtsCheck[] {
  return drafts.map(({ weight, ...rest }) => ({
    ...rest,
    penalty: Math.round(weight * PENALTY_SHARE[rest.severity] * 10) / 10,
  }));
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Position (0–1) of the first match within the text, or null. */
function firstPosition(text: string, pattern: RegExp): number | null {
  const m = pattern.exec(text);
  return m ? m.index / Math.max(1, text.length) : null;
}

function contactChecks(text: string, meta: ExtractMeta, lines: string[]): Draft[] {
  const out: Draft[] = [];
  const header = meta.headerFooterText ?? "";
  const emailPos = firstPosition(text, EMAIL);
  const phonePos = firstPosition(text, PHONE);

  if (emailPos !== null) {
    out.push({
      id: "contact.email",
      category: "contact",
      severity: "pass",
      title: "Email address found",
      detail: "An email address is in the body text, where every ATS looks for it.",
      weight: 0,
    });
  } else if (EMAIL.test(header)) {
    out.push({
      id: "contact.email",
      category: "contact",
      severity: "fail",
      title: "Email is only in the Word header or footer",
      detail:
        "Your email address sits in the document header/footer. Many ATS skip headers and footers entirely, so the application can arrive with no way to contact you.",
      fix: "Move your name, email and phone into the first lines of the document body.",
      weight: 16,
    });
  } else {
    out.push({
      id: "contact.email",
      category: "contact",
      severity: "fail",
      title: "No email address found",
      detail: "No email address could be read from the text. If it is inside an image, icon or text box, the ATS will not see it either.",
      fix: "Type your email address as plain text near the top of the resume.",
      weight: 16,
    });
  }

  if (phonePos !== null) {
    out.push({
      id: "contact.phone",
      category: "contact",
      severity: "pass",
      title: "Phone number found",
      detail: "A phone number is in the body text.",
      weight: 0,
    });
  } else {
    const inHeader = PHONE.test(header);
    out.push({
      id: "contact.phone",
      category: "contact",
      severity: "warn",
      title: inHeader ? "Phone number is only in the header or footer" : "No phone number found",
      detail: inHeader
        ? "Your phone number is in the Word header/footer, which many ATS ignore."
        : "No phone number could be read. Recruiters often filter on contactability.",
      fix: "Add your phone number as plain text next to your email at the top.",
      weight: 6,
    });
  }

  // Contact details that only show up near the end usually came from a
  // footer or a sidebar that the parser read last.
  const positions = [emailPos, phonePos].filter((p): p is number => p !== null);
  if (positions.length > 0 && lines.length >= 15) {
    const earliest = Math.min(...positions);
    if (earliest > 0.6) {
      out.push({
        id: "contact.late",
        category: "contact",
        severity: "warn",
        title: "Contact details appear late in the text",
        detail: `Your contact details first appear ${Math.round(earliest * 100)}% of the way through the extracted text. That usually means they sit in a footer, sidebar or text box that parsers read last, or drop.`,
        fix: "Put contact details in the body, directly under your name, in a single column.",
        weight: 8,
      });
    }
  }

  if (LINKEDIN.test(text)) {
    out.push({
      id: "contact.linkedin",
      category: "contact",
      severity: "pass",
      title: "LinkedIn profile found",
      detail: "A full linkedin.com/in/ URL is present.",
      weight: 0,
    });
  } else {
    const mentions = /linkedin/i.test(text);
    out.push({
      id: "contact.linkedin",
      category: "contact",
      severity: "warn",
      title: mentions ? "LinkedIn mentioned without a full URL" : "No LinkedIn URL",
      detail: mentions
        ? "\"LinkedIn\" appears, but not as a URL. An icon or hyperlink text is lost when the resume is parsed to plain text."
        : "Most recruiters check LinkedIn; without a URL they have to search for you.",
      fix: "Write the URL out in full, e.g. linkedin.com/in/your-name.",
      weight: 3,
    });
  }

  const github = GITHUB.test(text);
  const portfolio = PORTFOLIO.test(text.replace(EMAIL, " "));
  if (github || portfolio) {
    out.push({
      id: "contact.links",
      category: "contact",
      severity: "pass",
      title: github ? "GitHub profile found" : "Portfolio link found",
      detail: github && portfolio ? "GitHub and a portfolio site are linked." : "A link to your work is present as plain text.",
      weight: 0,
    });
  } else if (TECH.test(text)) {
    out.push({
      id: "contact.links",
      category: "contact",
      severity: "warn",
      title: "No GitHub or portfolio link",
      detail: "For technical roles a link to code or shipped work lets reviewers verify your skills.",
      fix: "If you have public work, add a GitHub or portfolio URL to your contact line.",
      weight: 2,
    });
  }

  const top = lines.slice(0, Math.max(8, Math.ceil(lines.length * 0.15))).join("\n");
  if (LOCATION.test(top)) {
    out.push({
      id: "contact.location",
      category: "contact",
      severity: "pass",
      title: "Location found",
      detail: "A city/region (or remote preference) is near the top. Many ATS filter candidates by location.",
      weight: 0,
    });
  } else {
    out.push({
      id: "contact.location",
      category: "contact",
      severity: "warn",
      title: "No location near the top",
      detail: "No city, state/country or \"Remote\" was found in the header area. Location filters can silently exclude resumes without one.",
      fix: "Add \"City, State\" (or \"City, Country\" / \"Remote\") to your contact line.",
      weight: 3,
    });
  }

  return out;
}

const CORE: Array<{ section: CanonicalSection; label: string; severity: AtsSeverity; weight: number; why: string }> = [
  { section: "experience", label: "Experience", severity: "fail", weight: 14, why: "Without a recognisable Experience heading, parsers cannot attach job titles, employers and dates to anything." },
  { section: "education", label: "Education", severity: "warn", weight: 6, why: "Education filters (degree, field) are common knock-out questions." },
  { section: "skills", label: "Skills", severity: "warn", weight: 6, why: "A Skills section is where ATS keyword extraction looks first." },
];

function sectionChecks(lines: string[]): { drafts: Draft[]; found: string[] } {
  const sections = findSections(lines);
  const found = new Set<CanonicalSection>();
  for (const s of sections) if (s.canonical !== "other") found.add(s.canonical);
  const out: Draft[] = [];

  for (const core of CORE) {
    const creative = sections.find((s) => s.suggested === core.label);
    if (found.has(core.section)) {
      const heading = sections.find((s) => s.canonical === core.section);
      out.push({
        id: `sections.${core.section}`,
        category: "sections",
        severity: "pass",
        title: `${core.label} section found`,
        detail: `Found the heading "${heading?.text ?? core.label}".`,
        weight: 0,
      });
    } else {
      out.push({
        id: `sections.${core.section}`,
        category: "sections",
        severity: creative ? "warn" : core.severity,
        title: creative
          ? `${core.label} section uses a non-standard heading`
          : `No ${core.label} section heading`,
        detail: creative
          ? `"${creative.text}" reads well to a person, but ATS parsers match headings against a fixed list. ${core.why}`
          : `No heading such as "${core.label}" was found. ${core.why}`,
        fix: `Use the plain heading "${core.label}".`,
        weight: core.weight,
      });
    }
  }

  const creative = sections.filter((s) => s.suggested && !CORE.some((c) => c.label === s.suggested && !found.has(c.section)));
  if (creative.length > 0) {
    out.push({
      id: "sections.creative",
      category: "sections",
      severity: "warn",
      title: `${plural(creative.length, "creative heading")} found`,
      detail: `${creative.map((s) => `"${s.text}"`).join(", ")} may not be recognised as sections.`,
      fix: creative.map((s) => `Rename "${s.text}" to "${s.suggested}".`).join(" "),
      weight: 4,
    });
  }

  const spaced = sections.filter((s) => s.letterSpaced);
  if (spaced.length > 0) {
    out.push({
      id: "sections.letter-spaced",
      category: "sections",
      severity: "warn",
      title: "Letter-spaced headings",
      detail: `Headings typed as spaced letters ("${spaced[0].text}") are read by most parsers as single letters, not words.`,
      fix: "Use real character spacing (tracking) in your editor, or type the heading normally.",
      weight: 5,
    });
  }

  const optional = (["summary", "projects", "certifications"] as const).filter((s) => found.has(s));
  const missingOptional = (["summary", "projects", "certifications"] as const).filter((s) => !found.has(s));
  out.push({
    id: "sections.optional",
    category: "sections",
    severity: "pass",
    title: optional.length ? `Also found: ${optional.map(cap).join(", ")}` : "Optional sections",
    detail: missingOptional.length
      ? `Not found: ${missingOptional.map(cap).join(", ")}. These are optional; add them only if you have real content for them.`
      : "Summary, Projects and Certifications headings are all present.",
    weight: 0,
  });

  const names = [...found].map(cap);
  return { drafts: out, found: names };
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function dateChecks(text: string, lines: string[], now: Date): { drafts: Draft[]; formats: Record<string, number> } {
  const out: Draft[] = [];
  const sections = findSections(lines);
  const allRanges = findDateRanges(lines);
  // Consistency is judged on work history: year-only education dates next to
  // month-precise job dates are standard and parse fine.
  const inSection = (line: number, target: CanonicalSection) =>
    sections.some(
      (s) =>
        (s.canonical === target || s.suggested?.toLowerCase() === target) && line > s.line && line <= s.endLine,
    );
  const workRanges = allRanges.filter((r) => inSection(r.line, "experience"));
  const ranges =
    workRanges.length > 0 ? workRanges : allRanges.filter((r) => !inSection(r.line, "education"));
  const formats: Record<string, number> = {};
  const families = new Set<DateFormat>();
  for (const r of ranges) {
    const tokens = r.end === "present" ? [r.start] : [r.start, r.end];
    for (const t of tokens) {
      formats[t.format] = (formats[t.format] ?? 0) + 1;
      families.add(t.format);
    }
  }

  if (ranges.length === 0) {
    out.push({
      id: "dates.found",
      category: "dates",
      severity: "fail",
      title: "No date ranges found",
      detail: "No employment dates such as \"Jan 2021 - Present\" could be read. ATS use dates to calculate years of experience; without them you may be filtered out.",
      fix: "Give every role a start and end date in the form \"Mon YYYY - Mon YYYY\" (or \"- Present\").",
      weight: 10,
    });
    return { drafts: out, formats };
  }

  const mixed = [...families].filter((f) => f !== "season");
  if (mixed.length > 1) {
    const counts = mixed.map((f) => `${formats[f]} ${FORMAT_LABEL[f]}`).join(", ");
    out.push({
      id: "dates.consistent",
      category: "dates",
      severity: "warn",
      title: "Date formats are inconsistent",
      detail: `Dates are written in ${mixed.length} different ways (${counts}). Inconsistent dates are a common cause of mis-parsed work history.`,
      fix: "Pick one format and use it everywhere. \"Jan 2021 - Mar 2023\" is the most widely parsed.",
      weight: 6,
    });
  } else {
    out.push({
      id: "dates.consistent",
      category: "dates",
      severity: mixed[0] === "year" ? "warn" : "pass",
      title: mixed[0] === "year" ? "Dates are years only" : "Date format is consistent",
      detail:
        mixed[0] === "year"
          ? "Every range uses years only. Some ATS round \"2022 - 2023\" to a few months, others to two years."
          : ranges.length === 1
            ? "Your work dates use a clear, parseable format."
            : `All ${ranges.length} work date ranges use the same format.`,
      fix: mixed[0] === "year" ? "Add months (\"Mar 2022 - Jan 2023\") so tenure is calculated correctly." : undefined,
      weight: mixed[0] === "year" ? 3 : 0,
    });
  }

  const presentWords = new Set(
    ranges.filter((r) => r.end === "present").map((r) => (r.presentWord ?? "").toLowerCase()),
  );
  const nonStandard = [...presentWords].filter((w) => w !== "present");
  if (nonStandard.length > 0) {
    out.push({
      id: "dates.present",
      category: "dates",
      severity: "warn",
      title: "Current role not marked \"Present\"",
      detail: `Ongoing roles end in ${nonStandard.map((w) => `"${w}"`).join(", ")}. "Present" is the term parsers are built around; other words can be read as missing end dates.`,
      fix: "End current roles with \"- Present\".",
      weight: 3,
    });
  }

  const reversed = ranges.filter(
    (r) => r.end !== "present" && r.end.year * 12 + r.end.month < r.start.year * 12 + r.start.month,
  );
  if (reversed.length > 0) {
    out.push({
      id: "dates.order",
      category: "dates",
      severity: "warn",
      title: "End date before start date",
      detail: `${reversed.map((r) => `"${r.raw}"`).join(", ")} ends before it starts.`,
      fix: "Check the order of these dates.",
      weight: 4,
    });
  }

  // Roles without dates: title-like lines in Experience with no date on or next to them.
  const experienceSections = sections.filter((s) => s.canonical === "experience" || s.suggested === "Experience");
  const undated: string[] = [];
  for (const s of experienceSections) {
    for (let i = s.line + 1; i <= s.endLine; i++) {
      const line = lines[i].trim();
      if (!line || BULLET_LINE.test(line) || line.split(/\s+/).length > 12) continue;
      if (!ROLE_WORDS.test(line)) continue;
      const near = [lines[i - 1] ?? "", line, lines[i + 1] ?? "", lines[i + 2] ?? ""];
      if (!near.some((l) => lineHasDate(l))) undated.push(line);
    }
  }
  if (undated.length > 0) {
    out.push({
      id: "dates.undated-roles",
      category: "dates",
      severity: "warn",
      title: `${plural(undated.length, "role")} without dates`,
      detail: `No dates were found next to: ${undated.slice(0, 3).map((l) => `"${l}"`).join(", ")}${undated.length > 3 ? "…" : ""}. Undated roles are often discarded when experience is calculated.`,
      fix: "Add a start and end month to every role, on the same line as the title or employer.",
      weight: 6,
    });
  }

  const estimate = estimateYearsExperience(text, now);
  if (estimate.years !== null) {
    out.push({
      id: "dates.experience",
      category: "dates",
      severity: "pass",
      title: `About ${estimate.years} year${estimate.years === 1 ? "" : "s"} of experience`,
      detail: `Estimated from ${plural(estimate.rangeCount, "date range")}${
        estimate.source === "experience-section" ? " in your Experience section" : ""
      }, with overlapping roles counted once. This is roughly what an ATS will compute.`,
      weight: 0,
    });
  }

  return { drafts: out, formats };
}

const FORMAT_LABEL: Record<DateFormat, string> = {
  "month-name": "month-name (Jan 2021)",
  numeric: "numeric (01/2021)",
  iso: "ISO (2021-01)",
  year: "year-only (2021)",
  season: "season (Summer 2021)",
};

function shortLineRatio(lines: string[]): number {
  const content = lines.map((l) => l.trim()).filter(Boolean);
  if (content.length < 25) return 0;
  const short = content.filter((l) => {
    const words = l.split(/\s+/).length;
    return words <= 2 && !BULLET_LINE.test(l) && !/^[A-Z][A-Z &/]+$/.test(l) && !/@|\d/.test(l);
  });
  return short.length / content.length;
}

function layoutChecks(meta: ExtractMeta, lines: string[], text: string): Draft[] {
  const out: Draft[] = [];
  const hints = meta.layoutHints ?? emptyLayoutHints();
  const textGlyphs = countGlyphHints(text);
  const privateUse = Math.max(hints.privateUseGlyphs, textGlyphs.privateUseGlyphs);
  const unmapped = Math.max(hints.unmappedGlyphs, textGlyphs.unmappedGlyphs);
  const icons = Math.max(hints.iconGlyphs, textGlyphs.iconGlyphs);

  const fragmented = shortLineRatio(lines);
  if (hints.likelyMultiColumn) {
    out.push({
      id: "layout.columns",
      category: "layout",
      severity: "fail",
      title: "Multi-column layout",
      detail: `Text is laid out in side-by-side columns${
        hints.multiColumnPages?.length ? ` on page ${hints.multiColumnPages.join(", ")}` : ""
      }. Many ATS read straight across the page, interleaving the columns into nonsense lines.`,
      fix: "Use a single-column layout. Sidebars for skills or contact details are the usual culprit.",
      weight: 18,
    });
  } else if (fragmented > 0.4) {
    out.push({
      id: "layout.columns",
      category: "layout",
      severity: fragmented > 0.55 ? "fail" : "warn",
      title: "Text extracts as many fragments",
      detail: `${Math.round(fragmented * 100)}% of lines are one or two words. That pattern usually comes from columns, tables or text boxes being read out of order.`,
      fix: "Check that your layout is a single column of normal paragraphs and bullets.",
      weight: fragmented > 0.55 ? 16 : 8,
    });
  } else {
    out.push({
      id: "layout.columns",
      category: "layout",
      severity: "pass",
      title: "Single-column reading order",
      detail: "No sign of side-by-side columns.",
      weight: 0,
    });
  }

  if (meta.kind === "docx") {
    if (meta.hasTables) {
      const ratio = meta.tableTextRatio ?? 0;
      const heavy = ratio > 0.3;
      out.push({
        id: "layout.tables",
        category: "layout",
        severity: heavy ? "fail" : "warn",
        title: heavy ? "Resume content is inside tables" : `${plural(meta.tableCount ?? 1, "table")} found`,
        detail: `${Math.round(ratio * 100)}% of the text sits in Word tables. Many ATS flatten or skip table cells, scrambling the order of titles, dates and employers.`,
        fix: "Replace tables with plain paragraphs; use tab stops if you need right-aligned dates.",
        weight: heavy ? 12 : 5,
      });
    } else {
      out.push({
        id: "layout.tables",
        category: "layout",
        severity: "pass",
        title: "No tables",
        detail: "The document body contains no Word tables.",
        weight: 0,
      });
    }
    if (hints.textBoxes) {
      out.push({
        id: "layout.text-boxes",
        category: "layout",
        severity: "warn",
        title: `${plural(hints.textBoxes, "text box", "text boxes")} found`,
        detail: "Text inside text boxes and shapes is skipped by many ATS.",
        fix: "Move text-box content into the normal document flow.",
        weight: 8,
      });
    }
    const headerText = (meta.headerFooterText ?? "").trim();
    if (headerText && !EMAIL.test(headerText) && !PHONE.test(headerText)) {
      out.push({
        id: "layout.header-footer",
        category: "layout",
        severity: "warn",
        title: "Content in the header or footer",
        detail: `"${headerText.slice(0, 80)}${headerText.length > 80 ? "…" : ""}" is in a Word header/footer, which many ATS ignore.`,
        fix: "Move anything important from the header/footer into the body.",
        weight: 3,
      });
    }
  }

  if (unmapped > 10 || (unmapped > 0 && unmapped / Math.max(1, text.length) > 0.01)) {
    out.push({
      id: "layout.glyphs",
      category: "layout",
      severity: "fail",
      title: "Unreadable characters",
      detail: `${plural(unmapped, "character")} could not be converted to text. The font encoding is broken, so parsers see garbage where your words should be.`,
      fix: "Re-export the PDF with standard fonts (or \"embed all fonts\"), or upload the DOCX instead.",
      weight: 12,
    });
  } else if (privateUse + icons > 0 || unmapped > 0) {
    out.push({
      id: "layout.glyphs",
      category: "layout",
      severity: "warn",
      title: "Icons or symbol bullets",
      detail: `${plural(privateUse + icons + unmapped, "icon or symbol glyph")} found (icon fonts, ✓/➢/★ bullets, phone/email symbols). These are dropped or turned into garbage characters by many parsers.`,
      fix: "Use plain round bullets and write labels as text (\"Email:\") instead of icons.",
      weight: 4,
    });
  } else {
    out.push({
      id: "layout.glyphs",
      category: "layout",
      severity: "pass",
      title: "Clean characters",
      detail: "No icon fonts or unreadable glyphs.",
      weight: 0,
    });
  }

  if (hints.imageOnlyPages?.length) {
    out.push({
      id: "layout.image-pages",
      category: "layout",
      severity: "fail",
      title: "Image-only page",
      detail: `Page ${hints.imageOnlyPages.join(", ")} contains an image but almost no text. Content in images is invisible to ATS.`,
      fix: "Export from your editor as a text-based PDF rather than scanning or saving as an image.",
      weight: 20,
    });
  }
  if (hints.emptyPages?.length) {
    out.push({
      id: "layout.empty-pages",
      category: "layout",
      severity: "warn",
      title: "Blank page",
      detail: `Page ${hints.emptyPages.join(", ")} has almost no readable text.`,
      fix: "Remove blank pages, or check that text on them is not drawn as outlines.",
      weight: 4,
    });
  }

  return out;
}

function lengthChecks(text: string, lines: string[], meta: ExtractMeta): { drafts: Draft[]; stats: Pick<AtsStats, "words" | "estimatedPages" | "bulletCount" | "longParagraphRatio"> } {
  const out: Draft[] = [];
  const words = countWords(text);
  const estimatedPages = meta.pages ?? Math.max(1, Math.round((words / 475) * 2) / 2);
  const bulletCount = lines.filter((l) => BULLET_LINE.test(l)).length;

  // Paragraphs: runs of non-blank, non-bullet, non-heading lines.
  let longWords = 0;
  let run = 0;
  const flush = () => {
    if (run > 60) longWords += run;
    run = 0;
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t || BULLET_LINE.test(t)) flush();
    // Short lines (titles, dates, headings) end a paragraph; only prose runs count.
    else if (countWords(t) >= 6) run += countWords(t);
    else flush();
  }
  flush();
  const longParagraphRatio = words ? Math.round((longWords / words) * 100) / 100 : 0;

  if (words < 150) {
    out.push({ id: "length.words", category: "length", severity: "fail", title: "Very little text", detail: `Only ${words} words were extracted. Either the resume is very thin or most of it was not readable.`, fix: "Check that the file is text-based and that each role has 2–5 bullets.", weight: 8 });
  } else if (words < 250) {
    out.push({ id: "length.words", category: "length", severity: "warn", title: "On the short side", detail: `${words} words. Most one-page resumes land between 400 and 700.`, fix: "Add accomplishments with results to your most relevant roles.", weight: 3 });
  } else if (words > 1100) {
    out.push({ id: "length.words", category: "length", severity: "warn", title: "Long resume", detail: `${words} words (about ${estimatedPages} pages). Recruiters skim; older or less relevant roles dilute the strongest ones.`, fix: "Trim to the most relevant 10–15 years and 2 pages at most.", weight: 4 });
  } else {
    out.push({ id: "length.words", category: "length", severity: "pass", title: `${words} words`, detail: `About ${estimatedPages} page${estimatedPages === 1 ? "" : "s"}: a comfortable length.`, weight: 0 });
  }

  if (estimatedPages > 3) {
    out.push({ id: "length.pages", category: "length", severity: "warn", title: `${estimatedPages} pages`, detail: "Beyond two pages, later content is rarely read.", fix: "Condense to two pages unless your field expects a full CV.", weight: 3 });
  }

  if (bulletCount === 0) {
    out.push({ id: "length.bullets", category: "length", severity: "warn", title: "No bullet points detected", detail: "Accomplishments written as paragraphs are harder to skim and to parse.", fix: "Break each role into 2–5 bullets that each start with an action verb.", weight: 4 });
  } else {
    out.push({ id: "length.bullets", category: "length", severity: "pass", title: `${plural(bulletCount, "bullet point")}`, detail: "Bulleted accomplishments parse and skim well.", weight: 0 });
  }

  if (longParagraphRatio > 0.3) {
    out.push({ id: "length.paragraphs", category: "length", severity: "warn", title: "Dense paragraphs", detail: `${Math.round(longParagraphRatio * 100)}% of your words sit in paragraphs longer than 60 words.`, fix: "Split long paragraphs into bullets; keep any summary to 2–3 lines.", weight: 3 });
  }

  return { drafts: out, stats: { words, estimatedPages, bulletCount, longParagraphRatio } };
}

function formatChecks(meta: ExtractMeta): Draft[] {
  if (meta.kind === "docx") {
    return [{ id: "format.kind", category: "format", severity: "pass", title: "DOCX", detail: "Word documents are the most reliably parsed format across ATS vendors.", weight: 0 }];
  }
  if (meta.kind === "pdf") {
    const scanned = (meta.layoutHints?.imageOnlyPages?.length ?? 0) > 0;
    const capped = meta.pages && meta.pagesProcessed && meta.pagesProcessed < meta.pages;
    return [
      {
        id: "format.kind",
        category: "format",
        severity: scanned ? "warn" : "pass",
        title: scanned ? "PDF with scanned pages" : "Text-based PDF",
        detail: scanned
          ? "Part of this PDF is an image. Some ATS run OCR, many do not."
          : `The PDF has a real text layer, which modern ATS read well. If an application portal offers DOCX, it is the safer choice.${
              capped ? ` Only the first ${meta.pagesProcessed} of ${meta.pages} pages were checked.` : ""
            }`,
        fix: scanned ? "Upload a PDF exported directly from your editor, or a DOCX." : undefined,
        weight: scanned ? 4 : 0,
      },
    ];
  }
  return [{ id: "format.kind", category: "format", severity: "pass", title: "Pasted text", detail: "Checks ran on pasted text, so file-level layout risks (columns, tables, headers) could not be assessed.", weight: 0 }];
}

function integrityChecks(text: string, meta: ExtractMeta) {
  const report = detectInjection(text, meta.hiddenTextFlags ?? []);
  const drafts: Draft[] = [];
  const strong = report.matches.filter((m) => m.strength === "strong" || m.inHiddenText);
  const lowConfidence = (meta.hiddenTextFlags ?? []).filter((f) => f.confidence === "low");

  if (strong.length > 0) {
    drafts.push({
      id: "integrity.injection",
      category: "integrity",
      severity: "fail",
      title: "Instructions aimed at AI screeners",
      detail: `The resume contains text that tries to instruct an automated screener: ${strong
        .slice(0, 2)
        .map((m) => `"${m.snippet}"`)
        .join("; ")}. Recruiters and many ATS vendors treat this as grounds for rejection, and it will not be followed here.`,
      fix: "Remove it. It cannot raise your score and is very visible to anyone who copies the text.",
      weight: 40,
    });
  }
  if (report.hiddenTextChars > 0) {
    const reasons = new Set((meta.hiddenTextFlags ?? []).filter((f) => f.confidence === "high").map((f) => REASON_LABEL[f.reason]));
    drafts.push({
      id: "integrity.hidden-text",
      category: "integrity",
      severity: report.hiddenTextChars >= 30 ? "fail" : "warn",
      title: "Hidden text",
      detail: `${plural(report.hiddenTextChars, "character")} of text a reader cannot see (${[...reasons].join(", ")}): "${(report.hiddenSamples[0] ?? "").slice(0, 100)}". Hidden keyword stuffing is shown in plain sight by every text-based ATS view.`,
      fix: "Delete the hidden text and work real keywords into your bullets instead.",
      weight: report.hiddenTextChars >= 30 ? 25 : 8,
    });
  }
  const weak = report.matches.filter((m) => m.strength === "weak" && !m.inHiddenText);
  if (weak.length > 0 && strong.length === 0) {
    drafts.push({
      id: "integrity.phrasing",
      category: "integrity",
      severity: "warn",
      title: "Phrase that resembles a scoring instruction",
      detail: `"${weak[0].snippet}" may read as an attempt to set your own score.`,
      fix: "Rephrase so it clearly describes your work.",
      weight: 4,
    });
  }
  if (lowConfidence.length > 0 && report.hiddenTextChars === 0) {
    drafts.push({
      id: "integrity.low-contrast",
      category: "integrity",
      severity: "pass",
      title: "White or invisible text (probably design)",
      detail: `Some text is drawn white or invisible, but on a page that also has coloured shapes or images — most likely a banner or an OCR layer. Sample: "${lowConfidence[0].sample.slice(0, 80)}".`,
      weight: 0,
    });
  }
  if (drafts.length === 0) {
    drafts.push({
      id: "integrity.clean",
      category: "integrity",
      severity: "pass",
      title: "No hidden text or AI instructions",
      detail: "Nothing in the file is hidden from a human reader or addressed to an automated screener.",
      weight: 0,
    });
  }
  return { drafts, report };
}

const REASON_LABEL: Record<string, string> = {
  "tiny-font": "microscopic font",
  "white-text": "white text",
  "off-page": "positioned off the page",
  "invisible-render": "invisible render mode",
  "hidden-run": "Word hidden formatting",
};

export function runAtsChecks(
  text: string,
  meta: ExtractMeta = { kind: "text", layoutHints: emptyLayoutHints() },
  now: Date = new Date(),
): AtsReport {
  const lines = text.split("\n");
  const integrity = integrityChecks(text, meta);
  const contact = contactChecks(text, meta, lines);
  const sections = sectionChecks(lines);
  const dates = dateChecks(text, lines, now);
  const layout = layoutChecks(meta, lines, text);
  const length = lengthChecks(text, lines, meta);
  const format = formatChecks(meta);

  const checks = finalize([
    ...integrity.drafts,
    ...contact,
    ...sections.drafts,
    ...dates.drafts,
    ...layout,
    ...length.drafts,
    ...format,
  ]);

  const penalty = checks.reduce((sum, c) => sum + c.penalty, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const risk: AtsReport["risk"] = score >= 80 ? "low" : score >= 55 ? "medium" : "high";

  const stats: AtsStats = {
    ...length.stats,
    characters: text.length,
    lines: lines.filter((l) => l.trim()).length,
    sectionsFound: sections.found,
    dateFormats: dates.formats,
    experience: estimateYearsExperience(text, now),
  };

  return {
    score,
    risk,
    checks,
    stats,
    suspectedInjection: integrity.report.suspectedInjection,
    integrity: integrity.report,
  };
}

/** Group checks by category in display order, dropping empty categories. */
export function groupChecks(report: Pick<AtsReport, "checks">): Array<{ category: AtsCategory; checks: AtsCheck[] }> {
  return ATS_CATEGORY_ORDER
    .map((category) => ({ category, checks: report.checks.filter((c) => c.category === category) }))
    .filter((g) => g.checks.length > 0);
}
