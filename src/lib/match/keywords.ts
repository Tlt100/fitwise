/**
 * Deterministic keyword engine: which terms does a job description ask for,
 * how much does each one matter, and where (if anywhere) does the resume show
 * it. No model is involved, so the same inputs always give the same answer and
 * every number in the UI can be traced to a line of text.
 *
 * Pure TypeScript with no I/O: safe to import from client components and from
 * route handlers alike.
 */
import { getLexicon, parseForm, type LexiconEntry, type TermCategory } from "./lexicon";
import { normKey, STOPWORDS, tokenize, type Token } from "./stem";

export type { TermCategory } from "./lexicon";
export type TermLocation = "skills" | "experience" | "summary" | "other";
export type MatchStatus = "exact" | "variant" | "missing";
export type JdSectionKind = "required" | "responsibilities" | "general" | "preferred" | "ignore";

export interface JdTerm {
  /** Display name: the lexicon's canonical name, or the posting's own spelling. */
  term: string;
  category: TermCategory;
  /** Relative importance within this posting. Larger is more important. */
  weight: number;
  /** Stated as a requirement rather than a preference. */
  required: boolean;
  /** How many times the posting mentions it (outside ignored sections). */
  count: number;
  /** Where the term came from: the curated lexicon, or capitalisation heuristics. */
  source: "lexicon" | "candidate";
  /** Lower-cased spellings the posting used, for "exact" comparisons. */
  jdForms: string[];
  /** The strongest section the term appeared in. */
  section: JdSectionKind;
}

export interface TermMatch {
  term: string;
  category: TermCategory;
  weight: number;
  required: boolean;
  status: MatchStatus;
  /** Resume sections the term was found in, in reading order. */
  locations: TermLocation[];
  /** Occurrences in the resume. */
  count: number;
  /** The resume's own spellings, so a variant can be shown as "you wrote k8s". */
  matchedForms: string[];
  source: "lexicon" | "candidate";
}

export interface CoverageSummary {
  /** 0-100: share of total term weight the resume covers. Null with no terms. */
  weightedCoveragePct: number | null;
  exactCount: number;
  variantCount: number;
  missingCount: number;
  totalTerms: number;
  /** Required terms the resume does not show at all, highest weight first. */
  requiredMissing: string[];
}

export interface MatchResult {
  terms: TermMatch[];
  coverage: CoverageSummary;
  /**
   * "sectioned" when the posting had recognisable requirement / preference
   * headings or cues; "unstructured" when it did not, in which case every
   * non-soft term is treated as required.
   */
  jdStructure: "sectioned" | "unstructured";
}

/** How much one occurrence counts, by the section it appears in. */
export const SECTION_WEIGHT: Record<JdSectionKind, number> = {
  required: 3,
  responsibilities: 2,
  general: 1.5,
  preferred: 1,
  ignore: 0,
};

/** Soft skills are cheap to claim and hard to verify, so they count for less. */
export const CATEGORY_MULTIPLIER: Record<TermCategory, number> = {
  hard: 1,
  tool: 1,
  cert: 1,
  soft: 0.5,
};

/** Heuristic candidates are less certain to be skills than lexicon entries. */
export const CANDIDATE_MULTIPLIER = 0.6;

/** Extra weight per repeat mention, capped so one term cannot dominate. */
export const REPEAT_BONUS = 0.5;
export const MAX_REPEAT_BONUS_MENTIONS = 3;

/** Credit a term earns towards coverage, by match status. */
export const STATUS_CREDIT: Record<MatchStatus, number> = {
  exact: 1,
  // Same skill, different spelling ("k8s", "managed" vs "managing"). A person
  // reads it as a match; a literal keyword filter may not.
  variant: 0.8,
  missing: 0,
};

export const MAX_TERMS = 40;
const MAX_CANDIDATES = 12;
const MAX_NGRAM = 4;

/* ------------------------------------------------------------------------ */
/* Lexicon index                                                             */
/* ------------------------------------------------------------------------ */

interface IndexedForm {
  entry: number;
  /** Raw tokens that must match exactly, when the form is case-sensitive. */
  surface: string[] | null;
  strict: boolean;
}

interface LexiconIndex {
  entries: LexiconEntry[];
  byKey: Map<string, IndexedForm[]>;
  byName: Map<string, number>;
  /** Normalised canonical spelling for each entry (for "exact"). */
  canonicalNorm: string[];
}

let indexCache: LexiconIndex | null = null;

function getIndex(): LexiconIndex {
  if (indexCache) return indexCache;
  const entries = getLexicon();
  const byKey = new Map<string, IndexedForm[]>();
  const byName = new Map<string, number>();
  const canonicalNorm: string[] = [];

  entries.forEach((entry, i) => {
    byName.set(entry.name.toLowerCase(), i);
    canonicalNorm.push(normKey(entry.name));
    for (const form of entry.forms) {
      const { text, caseSensitive, strict } = parseForm(form);
      const tokens = tokenize(text);
      if (!tokens.length || tokens.length > MAX_NGRAM) continue;
      const key = tokens.map((t) => t.stem).join(" ");
      const list = byKey.get(key) ?? [];
      // The first entry to claim a key keeps it; duplicates are caught by tests.
      if (list.some((f) => f.entry !== i)) continue;
      list.push({
        entry: i,
        surface: caseSensitive ? tokens.map((t) => t.raw) : null,
        strict,
      });
      byKey.set(key, list);
    }
  });

  indexCache = { entries, byKey, byName, canonicalNorm };
  return indexCache;
}

/** Look up a lexicon entry by canonical name (case-insensitive). */
export function findLexiconEntry(name: string): LexiconEntry | undefined {
  const index = getIndex();
  const i = index.byName.get(name.toLowerCase());
  return i === undefined ? undefined : index.entries[i];
}

/* ------------------------------------------------------------------------ */
/* Scanning                                                                  */
/* ------------------------------------------------------------------------ */

interface Hit {
  entry: number;
  first: number;
  length: number;
  line: number;
  /** Lower-cased tokens as written, joined by spaces. */
  norm: string;
}

/** Lines that are mostly capitals are headings or shouting, not prose. */
function capsLines(text: string): Set<number> {
  const result = new Set<number>();
  text.split(/\r?\n/).forEach((line, i) => {
    const letters = line.replace(/[^A-Za-z]/g, "");
    const words = line.trim().split(/\s+/).filter(Boolean).length;
    if (words >= 2 && letters.length >= 6) {
      const upper = letters.replace(/[^A-Z]/g, "").length;
      if (upper / letters.length > 0.8) result.add(i);
    }
  });
  return result;
}

const VERB_FOLLOWERS = new Set(
  (
    "above beyond to the through back ahead out live further into over from for a an get make find " +
    "build see deeper far forward on up down along after the extra all big fast home there in with"
  ).split(" "),
);

function formAccepts(form: IndexedForm, tokens: Token[], first: number, length: number, caps: Set<number>): boolean {
  if (!form.surface) return true;
  const firstToken = tokens[first];
  // Case carries no signal on an all-caps line ("MAKE IT HAPPEN").
  if (caps.has(firstToken.line)) return false;
  for (let k = 0; k < length; k += 1) {
    if (tokens[first + k].raw !== form.surface[k]) return false;
  }
  if (form.strict) {
    const last = tokens[first + length - 1];
    if (last.hyphenAfter) return false;
    if (length === 1 && firstToken.raw.length === 1 && last.periodAfter) return false;
    // "Go above and beyond", "Lean into it": at the start of a sentence and
    // followed by a word that only makes sense after the verb.
    const next = tokens[first + length];
    if (
      firstToken.sentenceStart &&
      next &&
      next.joinsPrevious &&
      VERB_FOLLOWERS.has(next.norm)
    ) {
      return false;
    }
  }
  return true;
}

/** Greedy longest-match scan of the text against the lexicon. */
function scanLexicon(tokens: Token[], caps: Set<number>): { hits: Hit[]; covered: Uint8Array } {
  const { byKey } = getIndex();
  const hits: Hit[] = [];
  const covered = new Uint8Array(tokens.length);
  let i = 0;
  while (i < tokens.length) {
    let matched = 0;
    for (let n = Math.min(MAX_NGRAM, tokens.length - i); n >= 1 && !matched; n -= 1) {
      // Phrases never span a line break or punctuation.
      let joined = true;
      for (let k = 1; k < n && joined; k += 1) joined = tokens[i + k].joinsPrevious;
      if (!joined) continue;
      let key = tokens[i].stem;
      for (let k = 1; k < n; k += 1) key += " " + tokens[i + k].stem;
      const forms = byKey.get(key);
      if (!forms) continue;
      const form = forms.find((f) => formAccepts(f, tokens, i, n, caps));
      if (!form) continue;
      hits.push({
        entry: form.entry,
        first: i,
        length: n,
        line: tokens[i].line,
        norm: tokens.slice(i, i + n).map((t) => t.norm).join(" "),
      });
      for (let k = 0; k < n; k += 1) covered[i + k] = 1;
      matched = n;
    }
    i += matched || 1;
  }
  return { hits, covered };
}

/* ------------------------------------------------------------------------ */
/* Section detection                                                         */
/* ------------------------------------------------------------------------ */

const JD_PREFERRED = /\b(nice[\s-]to[\s-]haves?|preferred|bonus|pluses|a plus|desired|desirable|optional|good[\s-]to[\s-]have|extra credit|ideally|ideal candidate|would be great|helpful)\b/i;
const JD_ABOUT_COMPANY = /^about\s+(?!(the )?(role|job|position|opportunity|you|this role)\b)/i;
const JD_IGNORE = /\b(about (us|the company)|benefits|perks|compensation|salary|pay range|equal (employment )?opportunity|eeo|why (join|work)|who we are|our (mission|values|culture|story)|life at|how to apply|what we offer|we offer|location|accommodations?|disclaimer|privacy notice)\b/i;
const JD_REQUIRED = /\b(requirements?|required|qualifications?|must[\s-]haves?|what you('ll)? (need|bring)|who you are|you have|you bring|minimum|basic qualifications|essential|skills|experience|about you|what we('re| are) looking for|you should have|competenc(y|ies))\b/i;
const JD_RESPONSIBILITIES = /\b(responsibilit(y|ies)|what you('ll| will)? do|duties|the role|your role|day[\s-]to[\s-]day|in this role|the job|you will|key tasks|what you'll be doing|your impact|the opportunity|job description|overview)\b/i;

const LINE_PREFERRED = /\b(preferred|nice[\s-]to[\s-]have|a plus|is a plus|bonus|desirable|ideally|helpful but not required|not required)\b/i;
const LINE_REQUIRED = /\b(required|must|mandatory|essential|minimum of|at least)\b/i;

function classifyJdHeading(label: string): JdSectionKind | null {
  if (JD_PREFERRED.test(label)) return "preferred";
  if (/^about (you|yourself)\b/i.test(label)) return "required";
  if (JD_ABOUT_COMPANY.test(label) || JD_IGNORE.test(label)) return "ignore";
  if (JD_RESPONSIBILITIES.test(label)) return "responsibilities";
  if (JD_REQUIRED.test(label)) return "required";
  return null;
}

const BULLET_PREFIX = /^[\s>*\-•●▪◦‣⁃·#]+/;

interface HeadingRead {
  label: string;
  /** Text after an inline "Label: content" heading, if any. */
  rest: string;
  isHeading: boolean;
  /** Unbulleted, unpunctuated and at most six words. */
  shortLine?: boolean;
}

/** Decide whether a line is a heading, and split off inline content. */
function readHeading(line: string): HeadingRead {
  const hadBullet = BULLET_PREFIX.test(line) && !/^\s*#/.test(line);
  const stripped = line.replace(BULLET_PREFIX, "").replace(/[*_]+/g, "").trim();
  if (!stripped) return { label: "", rest: "", isHeading: false };

  const inline = /^([^:.!?]{2,48}):\s*(\S.*)$/.exec(stripped);
  if (inline && inline[1].split(/\s+/).length <= 6) {
    return { label: inline[1], rest: inline[2], isHeading: true };
  }

  const label = stripped.replace(/[:\s]+$/, "");
  const words = label.split(/\s+/).length;
  if (hadBullet || words > 7 || label.length > 60 || /[.!?,;]$/.test(label)) {
    return { label, rest: "", isHeading: false };
  }
  const allCaps = /[A-Z]/.test(label) && label === label.toUpperCase();
  const endsColon = /:\s*$/.test(stripped);
  const markdown = /^\s*#/.test(line);
  const titleCase = label
    .split(/\s+/)
    .every((w) => /^[A-Z0-9&(]/.test(w) || /^(and|or|of|to|the|a|an|for|in|with|you|we|our|we're|you'll)$/i.test(w));
  return {
    label,
    rest: "",
    isHeading: allCaps || endsColon || markdown || (titleCase && words <= 6),
    shortLine: words <= 6,
  };
}

/**
 * Phrases specific enough to mark a heading even when written in sentence
 * case ("Nice to have", "What you'll do"). Bare "skills" or "experience" are
 * left out: "Experience with Rust" on its own line is content, not a heading.
 */
const JD_STRONG_HEADING = /^(nice[\s-]to[\s-]haves?|(preferred|minimum|basic|required|desired|bonus) (qualifications|skills|experience|requirements)|bonus points|requirements|qualifications|responsibilities|key responsibilities|what you('ll| will) (do|need|bring)|who you are|about you|what we('re| are) looking for|what we offer|benefits|perks|must[\s-]haves?)$/i;

/** Section kind for every line of a job description. */
export function detectJdSections(jd: string): JdSectionKind[] {
  const lines = jd.replace(/\r\n?/g, "\n").split("\n");
  const kinds: JdSectionKind[] = [];
  let current: JdSectionKind = "general";
  for (const line of lines) {
    const read = readHeading(line);
    if (!read.isHeading && read.shortLine && JD_STRONG_HEADING.test(read.label)) {
      read.isHeading = true;
    }
    if (read.isHeading) {
      const kind = classifyJdHeading(read.label);
      if (read.rest) {
        // "Location: Remote" or "Must have: Python" labels only its own line.
        kinds.push(kind ?? current);
        continue;
      }
      if (kind) current = kind;
    }
    kinds.push(current);
  }
  return kinds;
}

const RESUME_EXPERIENCE = /\b(experience|employment|work history|career history|professional background|projects?|internships?|positions held|volunteer(ing)?)\b/i;
const RESUME_SKILLS = /\b(skills?|technolog(y|ies)|tools|tech stack|competenc(y|ies)|proficienc(y|ies)|expertise|languages|frameworks)\b/i;
const RESUME_SUMMARY = /\b(summary|profile|objective|about( me)?|overview|introduction|highlights)\b/i;
const RESUME_OTHER = /\b(education|certifications?|licen[cs]es?|awards?|honou?rs|publications?|interests|hobbies|references|activities|courses?|coursework|training|achievements|accomplishments|affiliations|memberships|contact)\b/i;

const RESUME_HEADING_WORDS = new RegExp(
  [RESUME_EXPERIENCE, RESUME_SKILLS, RESUME_SUMMARY, RESUME_OTHER].map((r) => r.source).join("|"),
  "gi",
);
const HEADING_FILLER = /^(and|&|of|the|my|key|core|relevant|technical|professional|work|selected|additional|other|personal|career|academic|related|areas|leadership)$/i;

/**
 * Resume headings are short and made of heading vocabulary ("Technical
 * Skills", "Work Experience"). A title-case line such as "Senior Software
 * Engineer" or "Acme Technologies Inc" is a job or an employer, not a heading.
 */
function isResumeHeadingLabel(label: string): boolean {
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  const leftover = label
    .replace(RESUME_HEADING_WORDS, " ")
    .split(/[\s/,&+|-]+/)
    .filter((w) => w && !HEADING_FILLER.test(w));
  return leftover.length === 0 || (leftover.length === 1 && words.length >= 2);
}

function classifyResumeHeading(label: string): TermLocation | null {
  if (RESUME_EXPERIENCE.test(label)) return "experience";
  if (RESUME_SKILLS.test(label)) return "skills";
  if (RESUME_SUMMARY.test(label)) return "summary";
  if (RESUME_OTHER.test(label)) return "other";
  return null;
}

/**
 * Section for every line of a resume. Text before the first recognised heading
 * (name, contact line, an unlabelled summary paragraph) counts as "summary".
 */
export function detectResumeSections(resume: string): TermLocation[] {
  const lines = resume.replace(/\r\n?/g, "\n").split("\n");
  const sections: TermLocation[] = [];
  let current: TermLocation = "summary";
  for (const line of lines) {
    const read = readHeading(line);
    if (read.isHeading && isResumeHeadingLabel(read.label)) {
      const kind = classifyResumeHeading(read.label);
      if (read.rest) {
        // "Languages: Python, Go" labels its own line only.
        sections.push(kind ?? current);
        continue;
      }
      if (kind) current = kind;
    }
    sections.push(current);
  }
  return sections;
}

/* ------------------------------------------------------------------------ */
/* Candidate (non-lexicon) terms                                              */
/* ------------------------------------------------------------------------ */

const CANDIDATE_STOP = new Set(
  (
    "US USA UK EU EMEA APAC LATAM EEO EOE ADA AND OR THE WE YOU OUR LLC INC LTD CO CEO CFO CTO COO CMO CPO " +
    "VP SVP EVP HQ PTO FAQ ID OK ETA AM PM USD EUR GBP CAD AUD EST PST CST MST GMT UTC Q1 Q2 Q3 Q4 FY YOY YoY " +
    "ASAP TBD NA N/A TL;DR DM FYI NB PS RSVP LGBTQ LGBTQIA BIPOC W2 W-2 1099 401K 401k K12 K-12 NYC SF LA DC " +
    "TX CA NY WA MA IL FL GA CO NC VA NJ PA OH MI MN OR AZ II III IV VI " +
    "PLUS NEW ALL ANY NOT YOUR WHO WHAT HOW WHY WHEN ARE CAN WILL MUST"
  ).split(" "),
);

function isCandidateShape(raw: string): "acronym" | "camel" | "alnum" | null {
  if (raw.length < 2 || raw.length > 16) return null;
  if (/^[A-Z][A-Z0-9&+#]{1,7}$/.test(raw) && (raw.match(/[A-Z]/g) ?? []).length >= 2) return "acronym";
  if (/^[A-Za-z][a-z]+[A-Z][A-Za-z]*$/.test(raw) || /^[A-Z][a-z]*[A-Z][a-z]+[A-Za-z]*$/.test(raw)) return "camel";
  if (/^[A-Za-z][A-Za-z]*\d[A-Za-z0-9]*$/.test(raw) && /[A-Z]/.test(raw) && raw.length <= 10) return "alnum";
  return null;
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

interface Accumulator {
  term: string;
  category: TermCategory;
  source: "lexicon" | "candidate";
  count: number;
  best: JdSectionKind;
  sawRequired: boolean;
  sawGeneralOrResp: boolean;
  jdForms: Set<string>;
  order: number;
}

const SECTION_RANK: Record<JdSectionKind, number> = {
  ignore: 0,
  preferred: 1,
  general: 2,
  responsibilities: 3,
  required: 4,
};

export interface ExtractOptions {
  /** Cap on returned terms (default 40). */
  maxTerms?: number;
  /** Include heuristic candidates that are not in the lexicon (default true). */
  candidates?: boolean;
}

/**
 * Terms a job description asks for, weighted by how often and where they
 * appear. Requirements / qualifications / must-have sections outweigh
 * responsibilities, which outweigh nice-to-have / preferred / bonus sections;
 * benefits, "about us" and EEO boilerplate are ignored entirely.
 */
export function extractJdTerms(jd: string, options: ExtractOptions = {}): JdTerm[] {
  const maxTerms = options.maxTerms ?? MAX_TERMS;
  const tokens = tokenize(jd);
  const caps = capsLines(jd);
  const sectionOf = detectJdSections(jd);
  const lines = jd.replace(/\r\n?/g, "\n").split("\n");
  const index = getIndex();

  const lineKind = (line: number): JdSectionKind => {
    const section = sectionOf[line] ?? "general";
    if (section === "ignore") return "ignore";
    const text = lines[line] ?? "";
    if (LINE_PREFERRED.test(text)) return "preferred";
    if (LINE_REQUIRED.test(text)) return "required";
    return section;
  };

  const kinds = lines.map((_, i) => lineKind(i));
  const sectioned = jdStructureOf(jd) === "sectioned";

  const acc = new Map<string, Accumulator>();
  let order = 0;
  const record = (
    key: string,
    term: string,
    category: TermCategory,
    source: "lexicon" | "candidate",
    kind: JdSectionKind,
    form: string,
  ) => {
    if (kind === "ignore") return;
    let a = acc.get(key);
    if (!a) {
      a = {
        term,
        category,
        source,
        count: 0,
        best: kind,
        sawRequired: false,
        sawGeneralOrResp: false,
        jdForms: new Set(),
        order: order++,
      };
      acc.set(key, a);
    }
    a.count += 1;
    if (SECTION_RANK[kind] > SECTION_RANK[a.best]) a.best = kind;
    if (kind === "required") a.sawRequired = true;
    if (kind === "general" || kind === "responsibilities") a.sawGeneralOrResp = true;
    a.jdForms.add(form);
  };

  const { hits, covered } = scanLexicon(tokens, caps);
  for (const hit of hits) {
    const entry = index.entries[hit.entry];
    record(`lex:${hit.entry}`, entry.name, entry.category, "lexicon", kinds[hit.line], hit.norm);
  }

  if (options.candidates !== false) {
    tokens.forEach((token, i) => {
      if (covered[i] || caps.has(token.line)) return;
      const shape = isCandidateShape(token.raw);
      if (!shape || CANDIDATE_STOP.has(token.raw) || STOPWORDS.has(token.norm)) return;
      if (/^\d/.test(token.raw)) return;
      const key = `cand:${token.norm}`;
      record(key, token.raw, shape === "acronym" ? "hard" : "tool", "candidate", kinds[token.line], token.norm);
    });
  }

  const terms: JdTerm[] = [];
  for (const a of acc.values()) {
    const required = sectioned
      ? a.sawRequired
      : a.category !== "soft" && a.source === "lexicon";
    const repeats = Math.min(a.count - 1, MAX_REPEAT_BONUS_MENTIONS);
    let weight = SECTION_WEIGHT[a.best] + REPEAT_BONUS * repeats;
    weight *= CATEGORY_MULTIPLIER[a.category];
    if (a.source === "candidate") weight *= CANDIDATE_MULTIPLIER;
    terms.push({
      term: a.term,
      category: a.category,
      weight: Math.round(weight * 100) / 100,
      required,
      count: a.count,
      source: a.source,
      jdForms: [...a.jdForms],
      section: a.best,
    });
  }

  const orderOf = new Map([...acc.values()].map((a) => [a.term, a.order]));
  terms.sort(
    (x, y) =>
      y.weight - x.weight ||
      Number(y.required) - Number(x.required) ||
      (orderOf.get(x.term) ?? 0) - (orderOf.get(y.term) ?? 0),
  );

  const lexiconTerms = terms.filter((t) => t.source === "lexicon");
  const candidateTerms = terms.filter((t) => t.source === "candidate").slice(0, MAX_CANDIDATES);
  const kept = new Set([...lexiconTerms, ...candidateTerms]);
  return terms.filter((t) => kept.has(t)).slice(0, maxTerms);
}

/**
 * Where, and how literally, the resume shows each term. "exact" means the
 * resume uses the canonical name or the posting's own spelling; "variant"
 * means a recognised alias or inflection ("k8s" for Kubernetes, "managed" for
 * "managing"); "missing" means neither.
 */
export function matchTerms(resumeText: string, terms: JdTerm[], jdStructure: MatchResult["jdStructure"] = "sectioned"): MatchResult {
  const tokens = tokenize(resumeText);
  const caps = capsLines(resumeText);
  const sections = detectResumeSections(resumeText);
  const index = getIndex();

  interface Found {
    count: number;
    exact: boolean;
    locations: TermLocation[];
    forms: string[];
  }
  const found = new Map<number, Found>();
  const note = (termIdx: number, line: number, norm: string, exact: boolean) => {
    const f = found.get(termIdx) ?? { count: 0, exact: false, locations: [], forms: [] };
    f.count += 1;
    f.exact = f.exact || exact;
    const loc = sections[line] ?? "other";
    if (!f.locations.includes(loc)) f.locations.push(loc);
    if (!f.forms.includes(norm)) f.forms.push(norm);
    found.set(termIdx, f);
  };

  const exactSets = terms.map((t) => {
    const set = new Set(t.jdForms.map((f) => f.toLowerCase()));
    const entryIdx = t.source === "lexicon" ? index.byName.get(t.term.toLowerCase()) : undefined;
    if (entryIdx !== undefined) set.add(index.canonicalNorm[entryIdx]);
    else set.add(normKey(t.term));
    return set;
  });

  // Lexicon terms: scan the resume against the whole lexicon first, so that
  // "React Native" is consumed as React Native and never counted as React.
  const termByEntry = new Map<number, number>();
  terms.forEach((t, i) => {
    if (t.source !== "lexicon") return;
    const entryIdx = index.byName.get(t.term.toLowerCase());
    if (entryIdx !== undefined) termByEntry.set(entryIdx, i);
  });
  const { hits, covered } = scanLexicon(tokens, caps);
  for (const hit of hits) {
    const termIdx = termByEntry.get(hit.entry);
    if (termIdx === undefined) continue;
    note(termIdx, hit.line, hit.norm, exactSets[termIdx].has(hit.norm));
  }

  // Candidate terms: compare stems token by token over what the lexicon left.
  terms.forEach((t, termIdx) => {
    if (t.source !== "candidate") return;
    const needles = new Set([t.term, ...t.jdForms].map((f) => tokenize(f).map((x) => x.stem).join(" ")));
    tokens.forEach((token, i) => {
      if (covered[i]) return;
      if (needles.has(token.stem)) note(termIdx, token.line, token.norm, exactSets[termIdx].has(token.norm));
    });
  });

  const order: TermLocation[] = ["summary", "skills", "experience", "other"];
  const matches: TermMatch[] = terms.map((t, i) => {
    const f = found.get(i);
    const status: MatchStatus = !f ? "missing" : f.exact ? "exact" : "variant";
    return {
      term: t.term,
      category: t.category,
      weight: t.weight,
      required: t.required,
      status,
      locations: f ? [...f.locations].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : [],
      count: f?.count ?? 0,
      matchedForms: f?.forms ?? [],
      source: t.source,
    };
  });

  return { terms: matches, coverage: summarize(matches), jdStructure };
}

/** Coverage summary for a set of term matches. */
export function summarize(matches: TermMatch[]): CoverageSummary {
  let total = 0;
  let earned = 0;
  let exactCount = 0;
  let variantCount = 0;
  let missingCount = 0;
  for (const m of matches) {
    total += m.weight;
    earned += m.weight * STATUS_CREDIT[m.status];
    if (m.status === "exact") exactCount += 1;
    else if (m.status === "variant") variantCount += 1;
    else missingCount += 1;
  }
  const requiredMissing = matches
    .filter((m) => m.required && m.status === "missing")
    .sort((a, b) => b.weight - a.weight)
    .map((m) => m.term);
  return {
    weightedCoveragePct: total > 0 ? Math.round((earned / total) * 100) : null,
    exactCount,
    variantCount,
    missingCount,
    totalTerms: matches.length,
    requiredMissing,
  };
}

/** Whether a job description carries requirement/preference structure. */
export function jdStructureOf(jd: string): MatchResult["jdStructure"] {
  const lines = jd.replace(/\r\n?/g, "\n").split("\n");
  const sections = detectJdSections(jd);
  // A requirements or preferences section, or at least two lines that say
  // "required" / "preferred" in so many words. One "you must be passionate"
  // in an intro paragraph is not structure.
  const hasSection = sections.some((k) => k === "required" || k === "preferred");
  const cueLines = lines.filter(
    (line, i) => sections[i] !== "ignore" && (LINE_PREFERRED.test(line) || LINE_REQUIRED.test(line)),
  ).length;
  return hasSection || cueLines >= 2 ? "sectioned" : "unstructured";
}

/** Convenience: extract the posting's terms and match the resume in one call. */
export function matchResumeToJob(resumeText: string, jobDescription: string, options?: ExtractOptions): MatchResult {
  return matchTerms(resumeText, extractJdTerms(jobDescription, options), jdStructureOf(jobDescription));
}
