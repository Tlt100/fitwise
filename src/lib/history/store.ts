/**
 * Local, opt-in history of past analyses, for comparing several postings.
 *
 * Privacy contract:
 * - Off by default. Nothing is written until the user turns it on, and turning
 *   it off deletes everything that was stored.
 * - Resume text is never stored. Only a hash of it (to tell which resume an
 *   entry was scored against) and, optionally, the file name.
 * - localStorage only. Nothing here talks to a server.
 *
 * Every storage access is wrapped: storage can be missing (SSR), blocked
 * (privacy modes) or full, and history is a convenience, never a requirement.
 */

export const HISTORY_OPT_IN_KEY = "fitwise-history-opt-in";
export const HISTORY_ENTRIES_KEY = "fitwise-history-v1";
export const HISTORY_CHANGE_EVENT = "fitwise-history-change";
export const MAX_HISTORY_ENTRIES = 25;
/** Stored `analysis` payloads larger than this are dropped to protect the quota. */
export const MAX_ANALYSIS_BYTES = 60_000;

export interface HistoryScores {
  composite?: number;
  keywordCoverage?: number;
  ats?: number;
  evidence?: number;
}

export interface HistoryEntry {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  roleTitle: string;
  company?: string;
  jdText: string;
  jdHash: string;
  resumeFileName?: string;
  resumeHash: string;
  scores: HistoryScores;
  missingKeywords: string[];
  analysis?: unknown;
}

export const SCORE_KEYS = ["composite", "keywordCoverage", "ats", "evidence"] as const;

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a (two independent 32-bit passes => 64 bits) over whitespace-collapsed,
 * lowercased text. Not cryptographic: it identifies "the same posting / same
 * resume" locally and is never used for security.
 */
export function hashText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ normalized.length;
  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x0100019d);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* Storage access                                                      */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function notify() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(HISTORY_CHANGE_EVENT));
  } catch {
    // Event construction can fail in exotic environments; listeners just miss one tick.
  }
}

export function isHistoryEnabled(): boolean {
  try {
    return storage()?.getItem(HISTORY_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turning history off deletes every stored entry. */
export function setHistoryEnabled(enabled: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    if (enabled) {
      store.setItem(HISTORY_OPT_IN_KEY, "1");
    } else {
      store.removeItem(HISTORY_OPT_IN_KEY);
      store.removeItem(HISTORY_ENTRIES_KEY);
    }
  } catch {
    // Blocked storage: the toggle simply does not stick.
  }
  notify();
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function score(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanAnalysis(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    const json = JSON.stringify(value);
    return json && json.length <= MAX_ANALYSIS_BYTES ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rebuild an entry from untrusted data (storage or an imported file), keeping
 * only known fields. Unknown keys — including any `resumeText` someone put in
 * an import file — are dropped. Returns null when the essentials are missing.
 */
export function sanitizeEntry(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const jdText = str(r.jdText, 20_000);
  const resumeHash = str(r.resumeHash, 64);
  if (!jdText || !resumeHash) return null;

  const createdAt = str(r.createdAt, 40);
  const date = createdAt ? new Date(createdAt) : null;
  const scoresIn = (r.scores && typeof r.scores === "object" ? r.scores : {}) as Record<string, unknown>;
  const scores: HistoryScores = {};
  for (const key of SCORE_KEYS) {
    const value = score(scoresIn[key]);
    if (value !== undefined) scores[key] = value;
  }

  const entry: HistoryEntry = {
    id: str(r.id, 64) ?? newId(),
    createdAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString(),
    roleTitle: str(r.roleTitle, 160) ?? "Untitled role",
    jdText,
    jdHash: str(r.jdHash, 64) ?? hashText(jdText),
    resumeHash,
    scores,
    missingKeywords: normalizeKeywords(r.missingKeywords),
  };
  const company = str(r.company, 120);
  if (company) entry.company = company;
  const resumeFileName = str(r.resumeFileName, 200);
  if (resumeFileName) entry.resumeFileName = resumeFileName;
  const analysis = cleanAnalysis(r.analysis);
  if (analysis !== undefined) entry.analysis = analysis;
  return entry;
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const k = str(item, 80);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= 40) break;
  }
  return out;
}

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

/** Parse the stored list. Exported for tests and for the hook's snapshot cache. */
export function parseEntries(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeEntry)
      .filter((e): e is HistoryEntry => e !== null)
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function readRawEntries(): string | null {
  try {
    return storage()?.getItem(HISTORY_ENTRIES_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Newest first. Empty when history is off. */
export function listEntries(): HistoryEntry[] {
  if (!isHistoryEnabled()) return [];
  return parseEntries(readRawEntries());
}

function write(entries: HistoryEntry[]): boolean {
  const store = storage();
  if (!store) return false;
  let list = entries.slice(0, MAX_HISTORY_ENTRIES);
  // If the quota is hit, shed the stored analyses first, then the oldest entries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      store.setItem(HISTORY_ENTRIES_KEY, JSON.stringify(list));
      notify();
      return true;
    } catch {
      if (attempt === 0) {
        list = list.map((e) => {
          const copy = { ...e };
          delete copy.analysis;
          return copy;
        });
      } else {
        list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
      }
    }
  }
  return false;
}

/**
 * Save an entry (newest first). An entry for the same posting scored against
 * the same resume replaces the older one. No-op when history is off.
 */
export function addEntry(entry: HistoryEntry): HistoryEntry | null {
  if (!isHistoryEnabled()) return null;
  const clean = sanitizeEntry(entry);
  if (!clean) return null;
  const rest = listEntries().filter(
    (e) => e.id !== clean.id && !(e.jdHash === clean.jdHash && e.resumeHash === clean.resumeHash),
  );
  return write([clean, ...rest]) ? clean : null;
}

export function removeEntry(id: string): void {
  if (!isHistoryEnabled()) return;
  write(listEntries().filter((e) => e.id !== id));
}

export function clearHistory(): void {
  try {
    storage()?.removeItem(HISTORY_ENTRIES_KEY);
  } catch {
    // ignore
  }
  notify();
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

export interface HistoryExport {
  app: "fitwise";
  version: 1;
  exportedAt: string;
  entries: HistoryEntry[];
}

export function exportHistory(entries: HistoryEntry[] = listEntries()): string {
  const payload: HistoryExport = {
    app: "fitwise",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  return JSON.stringify(payload, null, 2);
}

export interface ImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

/**
 * Merge entries from an export file. Accepts the export envelope or a bare
 * array. Entries already present (same id, or same posting + resume) are kept
 * as they are. The result is capped at MAX_HISTORY_ENTRIES, newest first.
 */
export function importHistory(json: string): ImportResult {
  if (!isHistoryEnabled()) {
    return { imported: 0, skipped: 0, error: "Turn history on before importing." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { imported: 0, skipped: 0, error: "That file is not valid JSON." };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;
  if (!list) {
    return { imported: 0, skipped: 0, error: "That file is not a Fitwise history export." };
  }

  const existing = listEntries();
  const ids = new Set(existing.map((e) => e.id));
  const pairs = new Set(existing.map((e) => `${e.jdHash}:${e.resumeHash}`));
  const incoming: HistoryEntry[] = [];
  let skipped = 0;
  for (const raw of list.slice(0, 200)) {
    const entry = sanitizeEntry(raw);
    const pair = entry ? `${entry.jdHash}:${entry.resumeHash}` : "";
    if (!entry || ids.has(entry.id) || pairs.has(pair)) {
      skipped += 1;
      continue;
    }
    ids.add(entry.id);
    pairs.add(pair);
    incoming.push(entry);
  }

  const merged = [...existing, ...incoming].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = merged.slice(0, MAX_HISTORY_ENTRIES);
  const keptIds = new Set(kept.map((e) => e.id));
  const imported = incoming.filter((e) => keptIds.has(e.id)).length;
  skipped += incoming.length - imported;

  if (!write(kept)) {
    return { imported: 0, skipped: list.length, error: "Could not save to this browser's storage." };
  }
  return { imported, skipped };
}

/* ------------------------------------------------------------------ */
/* Mapping an analysis into an entry                                   */
/* ------------------------------------------------------------------ */

export interface ToHistoryEntryInput {
  /** The analyze response. Read loosely; any shape is tolerated. */
  analysis?: unknown;
  /** Used only to compute a hash. Never stored. */
  resumeText: string;
  jobDescription: string;
  resumeFileName?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  /** Explicit scores win over anything derived from `analysis`. */
  scores?: Partial<Record<keyof HistoryScores, number | null | undefined>>;
  missingKeywords?: string[] | null;
  /**
   * Store the full analysis object. Off by default: analyses quote resume
   * lines as evidence, so storing them stores fragments of the resume.
   */
  keepAnalysis?: boolean;
  createdAt?: Date | string;
  id?: string;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    const n = score(rec(c).score ?? c);
    if (n !== undefined) return n;
  }
  return undefined;
}

function dimension(analysis: Record<string, unknown>, pattern: RegExp): number | undefined {
  const dims = Array.isArray(analysis.dimensions) ? analysis.dimensions : [];
  for (const d of dims) {
    const r = rec(d);
    if (typeof r.name === "string" && pattern.test(r.name)) return score(r.score);
  }
  return undefined;
}

/**
 * Map an analysis (current shape or a future one) into a HistoryEntry.
 *
 * Looks for scores in, in order: the explicit `scores` input; `scores.*`;
 * the analyze response's `score.composite` / `score.components` and
 * `match.coverage`; top-level fields such as `compositeScore`, `atsScore`
 * (and the legacy `overallScore` last for composite); then the analysis
 * dimensions ("Keywords", "Experience"); then `keywords[].presentInResume`.
 * Missing keywords come from `missingKeywords`, else from keywords not in the
 * resume plus `missingSkills[].skill`.
 */
export function toHistoryEntry(input: ToHistoryEntryInput): HistoryEntry {
  const a = rec(input.analysis);
  const s = rec(a.scores);
  const explicit = input.scores ?? {};

  const keywordList = Array.isArray(a.keywords) ? a.keywords.map(rec) : [];
  const coverageFromKeywords = keywordList.length
    ? (keywordList.filter((k) => k.presentInResume === true).length / keywordList.length) * 100
    : undefined;

  // The analyze response's composite score and deterministic match, when the
  // caller passed the whole response rather than just `analysis`.
  const composite = rec(a.score);
  const component = (id: string) =>
    (Array.isArray(composite.components) ? composite.components : [])
      .map(rec)
      .find((c) => c.id === id)?.score;
  const matchCoverage = rec(rec(a.match).coverage);

  const scores: HistoryScores = {};
  const set = (key: keyof HistoryScores, value: number | undefined) => {
    if (value !== undefined) scores[key] = value;
  };
  set("composite", num(
      explicit.composite,
      s.composite,
      composite.composite,
      a.compositeScore,
      a.composite,
      // Legacy: analyses from before the composite score carried a model score.
      a.overallScore,
    ));
  set(
    "keywordCoverage",
    num(
      explicit.keywordCoverage,
      s.keywordCoverage,
      a.keywordCoverage,
      component("keywords"),
      matchCoverage.weightedCoveragePct,
      dimension(a, /keyword/i),
      coverageFromKeywords,
    ),
  );
  set("ats", num(explicit.ats, s.ats, component("ats"), a.atsScore, a.ats));
  set("evidence", num(
      explicit.evidence,
      s.evidence,
      component("requirements"),
      a.evidenceScore,
      a.evidence,
      dimension(a, /experience|evidence/i),
    ));

  let missing = input.missingKeywords ?? undefined;
  if (!missing) {
    const requiredMissing = Array.isArray(matchCoverage.requiredMissing)
      ? matchCoverage.requiredMissing.filter((v): v is string => typeof v === "string")
      : [];
    missing = [
      ...requiredMissing,
      ...keywordList
        .filter((k) => k.presentInResume === false && typeof k.keyword === "string")
        .map((k) => k.keyword as string),
      ...(Array.isArray(a.missingSkills) ? a.missingSkills : [])
        .map((m) => rec(m).skill)
        .filter((v): v is string => typeof v === "string"),
    ];
  }

  const createdAt =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : input.createdAt ?? new Date().toISOString();

  const entry: HistoryEntry = {
    id: input.id ?? newId(),
    createdAt,
    roleTitle:
      str(input.roleTitle, 160) ?? str(a.roleTitle, 160) ?? deriveRoleTitle(input.jobDescription),
    jdText: input.jobDescription.trim().slice(0, 20_000),
    jdHash: hashText(input.jobDescription),
    resumeHash: hashText(input.resumeText),
    scores,
    missingKeywords: normalizeKeywords(missing),
  };
  const company = str(input.company, 120) ?? str(a.company, 120) ?? str(a.companyName, 120);
  if (company) entry.company = company;
  const fileName = str(input.resumeFileName, 200);
  if (fileName) entry.resumeFileName = fileName;
  if (input.keepAnalysis) {
    const analysis = cleanAnalysis(input.analysis);
    if (analysis !== undefined) entry.analysis = analysis;
  }
  return entry;
}

function deriveRoleTitle(jd: string): string {
  const first = jd
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return first ? first.slice(0, 80) : "Untitled role";
}
