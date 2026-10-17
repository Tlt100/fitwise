/**
 * Section heading recognition. ATS parsers segment a resume by matching
 * headings against a fixed vocabulary; anything outside it tends to get its
 * content filed under the previous section or dropped.
 */

export type CanonicalSection =
  | "experience"
  | "education"
  | "skills"
  | "summary"
  | "projects"
  | "certifications"
  | "other";

const STANDARD: Record<Exclude<CanonicalSection, "other">, string[]> = {
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "relevant experience",
    "employment",
    "employment history",
    "work history",
    "career history",
    "professional background",
    "experience and employment",
    "industry experience",
    "internships",
    "internship experience",
  ],
  education: [
    "education",
    "academic background",
    "education and training",
    "academics",
    "academic history",
    "education and certifications",
    "qualifications",
  ],
  skills: [
    "skills",
    "technical skills",
    "core competencies",
    "competencies",
    "key skills",
    "skills and tools",
    "skills and technologies",
    "tools and technologies",
    "technologies",
    "areas of expertise",
    "expertise",
    "skills and abilities",
    "core skills",
    "professional skills",
    "skills and interests",
  ],
  summary: [
    "summary",
    "professional summary",
    "profile",
    "professional profile",
    "objective",
    "career objective",
    "career summary",
    "summary of qualifications",
    "about me",
    "about",
    "personal statement",
  ],
  projects: [
    "projects",
    "personal projects",
    "selected projects",
    "key projects",
    "academic projects",
    "relevant projects",
    "side projects",
    "technical projects",
  ],
  certifications: [
    "certifications",
    "certificates",
    "certification",
    "licenses",
    "licenses and certifications",
    "certifications and licenses",
    "credentials",
    "professional certifications",
  ],
};

/** Recognised secondary headings: fine for ATS, they just are not core sections. */
const SECONDARY = [
  "awards",
  "honors",
  "honors and awards",
  "awards and honors",
  "achievements",
  "publications",
  "languages",
  "interests",
  "hobbies",
  "volunteer",
  "volunteering",
  "volunteer experience",
  "leadership",
  "leadership experience",
  "activities",
  "extracurricular activities",
  "references",
  "coursework",
  "relevant coursework",
  "contact",
  "contact information",
  "patents",
  "presentations",
  "research",
  "research experience",
  "professional development",
  "training",
  "affiliations",
  "memberships",
  "professional affiliations",
  "military service",
];

/**
 * Headings that read well to a person but match nothing an ATS looks for,
 * each with the standard heading it should become.
 */
const CREATIVE: Array<[RegExp, string]> = [
  [/^(my )?(career )?journey$/, "Experience"],
  [/^where i'?ve (been|worked)$/, "Experience"],
  [/^(places|companies) i'?ve worked$/, "Experience"],
  [/^(my )?(professional )?(story|adventures?|path)$/, "Experience"],
  [/^what i'?ve done$/, "Experience"],
  [/^(the )?(work|jobs|gigs)$/, "Experience"],
  [/^(track record|career highlights|highlights)$/, "Experience"],
  [/^what i (bring|offer|do|know)( to the table)?$/, "Skills"],
  [/^(my )?(toolbox|toolkit|tool belt|arsenal|tech stack|stack)$/, "Skills"],
  [/^(my )?(super ?powers|strengths|talents|abilities)$/, "Skills"],
  [/^things i'?ve (built|made|shipped)$/, "Projects"],
  [/^(stuff|things) i'?ve (built|made)$/, "Projects"],
  [/^(my )?(work|portfolio|creations|builds)$/, "Projects"],
  [/^(where i (studied|learned)|learning|schooling|my education)$/, "Education"],
  [/^(who i am|hello|hi|hey there|intro|introduction|me in a nutshell)$/, "Summary"],
];

export type Heading = {
  line: number;
  text: string;
  canonical: CanonicalSection;
  /** Set when the heading is a recognisable creative variant. */
  suggested?: string;
  /** "E X P E R I E N C E" style headings. */
  letterSpaced: boolean;
};

export type Section = Heading & { endLine: number };

const lookup = new Map<string, CanonicalSection>();
for (const [canonical, names] of Object.entries(STANDARD)) {
  for (const name of names) lookup.set(name, canonical as CanonicalSection);
}
for (const name of SECONDARY) lookup.set(name, "other");

/** Collapse "E X P E R I E N C E" into "EXPERIENCE". */
function collapseLetterSpacing(line: string): { text: string; spaced: boolean } {
  if (/^(?:\p{L} ){3,}\p{L}(?:\s{2,}(?:\p{L} )*\p{L})*$/u.test(line)) {
    const words = line.split(/\s{2,}/).map((w) => w.replace(/ /g, ""));
    return { text: words.join(" "), spaced: true };
  }
  return { text: line, spaced: false };
}

export function headingKey(line: string): { key: string; spaced: boolean } {
  const trimmed = line.trim().replace(/^[#*=\-_\s|]+|[#*=\-_\s|:.]+$/g, "");
  const { text, spaced } = collapseLetterSpacing(trimmed);
  const key = text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { key, spaced };
}

/** Classify a single line as a heading, or return null. */
export function classifyHeading(line: string, index = 0): Heading | null {
  const raw = line.trim();
  if (!raw) return null;
  if (/^[-*•]/.test(raw)) return null;
  // "Skills: Python, SQL" — a heading with its content on the same line.
  const inline = /^([\p{L} &/]{3,40}):\s+\S/u.exec(raw);
  if (inline) {
    const canonical = lookup.get(headingKey(inline[1]).key);
    if (canonical) return { line: index, text: inline[1], canonical, letterSpaced: false };
  }
  if (raw.length > 48) return null;
  const { key, spaced } = headingKey(raw);
  if (!key || key.split(" ").length > 6) return null;

  const canonical = lookup.get(key);
  if (canonical) {
    return { line: index, text: raw, canonical, letterSpaced: spaced };
  }
  for (const [pattern, suggested] of CREATIVE) {
    if (pattern.test(key)) {
      return {
        line: index,
        text: raw,
        canonical: "other",
        suggested,
        letterSpaced: spaced,
      };
    }
  }
  return null;
}

export function findSections(lines: string[]): Section[] {
  const headings: Heading[] = [];
  lines.forEach((line, i) => {
    const heading = classifyHeading(line, i);
    if (heading) headings.push(heading);
  });
  return headings.map((h, i) => ({
    ...h,
    endLine: i + 1 < headings.length ? headings[i + 1].line - 1 : lines.length - 1,
  }));
}

/** Map a creative heading's suggestion back to a canonical section. */
export function canonicalFromSuggestion(suggested: string): CanonicalSection {
  const key = suggested.toLowerCase();
  return key in STANDARD ? (key as CanonicalSection) : "other";
}

/** Line ranges belonging to one canonical section (creative headings included). */
export function sectionLines(
  lines: string[],
  sections: Section[],
  target: CanonicalSection,
): string[] {
  const out: string[] = [];
  for (const s of sections) {
    const canonical = s.suggested ? canonicalFromSuggestion(s.suggested) : s.canonical;
    if (canonical === target) out.push(...lines.slice(s.line + 1, s.endLine + 1));
  }
  return out;
}
