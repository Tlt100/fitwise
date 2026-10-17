import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_ENTRIES_KEY,
  MAX_HISTORY_ENTRIES,
  addEntry,
  clearHistory,
  exportHistory,
  hashText,
  importHistory,
  isHistoryEnabled,
  listEntries,
  removeEntry,
  sanitizeEntry,
  setHistoryEnabled,
  toHistoryEntry,
  type HistoryEntry,
} from "./store";
import { aggregateMissingKeywords, bestIndex, presentScoreKeys } from "./compare";

class MemoryStorage {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new Error("QuotaExceededError");
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

let storage: MemoryStorage;
let events = 0;

beforeEach(() => {
  storage = new MemoryStorage();
  events = 0;
  vi.stubGlobal("window", {
    localStorage: storage,
    dispatchEvent: () => {
      events += 1;
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESUME = "Jane Doe. Built React dashboards.";

function entry(overrides: Partial<Parameters<typeof toHistoryEntry>[0]> = {}): HistoryEntry {
  return toHistoryEntry({
    resumeText: RESUME,
    jobDescription: "Frontend Engineer\nWe need React.",
    analysis: { roleTitle: "Frontend Engineer", overallScore: 70 },
    ...overrides,
  });
}

describe("opt-in", () => {
  it("is off by default and writes nothing", () => {
    expect(isHistoryEnabled()).toBe(false);
    expect(addEntry(entry())).toBeNull();
    expect(storage.data.size).toBe(0);
    expect(listEntries()).toEqual([]);
  });

  it("turning off deletes stored entries", () => {
    setHistoryEnabled(true);
    addEntry(entry());
    expect(listEntries()).toHaveLength(1);
    setHistoryEnabled(false);
    expect(storage.data.size).toBe(0);
    expect(events).toBeGreaterThan(0);
  });

  it("is SSR-safe without window", () => {
    vi.unstubAllGlobals();
    expect(isHistoryEnabled()).toBe(false);
    expect(listEntries()).toEqual([]);
    expect(() => setHistoryEnabled(true)).not.toThrow();
    expect(() => clearHistory()).not.toThrow();
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("SecurityError");
      },
      dispatchEvent: () => true,
    });
    expect(isHistoryEnabled()).toBe(false);
    expect(() => setHistoryEnabled(true)).not.toThrow();
  });
});

describe("CRUD", () => {
  beforeEach(() => setHistoryEnabled(true));

  it("never stores resume text", () => {
    addEntry({ ...entry(), resumeText: RESUME } as HistoryEntry);
    const raw = storage.getItem(HISTORY_ENTRIES_KEY)!;
    expect(raw).not.toContain("Jane Doe");
    expect(raw).toContain(hashText(RESUME));
  });

  it("puts newest first and replaces the same posting + resume", () => {
    const a = addEntry(entry({ jobDescription: "Role A posting" }))!;
    addEntry(entry({ jobDescription: "Role B posting" }));
    addEntry(entry({ jobDescription: "role a   posting", analysis: { overallScore: 90 } }));
    const list = listEntries();
    expect(list).toHaveLength(2);
    expect(list[0].scores.composite).toBe(90);
    expect(list.some((e) => e.id === a.id)).toBe(false);
  });

  it(`caps at ${MAX_HISTORY_ENTRIES}`, () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i += 1) {
      addEntry(entry({ jobDescription: `posting ${i}` }));
    }
    const list = listEntries();
    expect(list).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(list[0].jdText).toBe("posting 29");
  });

  it("removes and clears", () => {
    const a = addEntry(entry({ jobDescription: "A" }))!;
    addEntry(entry({ jobDescription: "B" }));
    removeEntry(a.id);
    expect(listEntries().map((e) => e.jdText)).toEqual(["B"]);
    clearHistory();
    expect(listEntries()).toEqual([]);
    expect(isHistoryEnabled()).toBe(true);
  });

  it("tolerates corrupt storage", () => {
    storage.setItem(HISTORY_ENTRIES_KEY, "{not json");
    expect(listEntries()).toEqual([]);
    storage.setItem(HISTORY_ENTRIES_KEY, JSON.stringify([{ junk: true }, entry()]));
    expect(listEntries()).toHaveLength(1);
  });

  it("sheds stored analyses when the quota is hit", () => {
    const big = entry({ keepAnalysis: true, analysis: { roleTitle: "R", blob: "x".repeat(20_000) } });
    expect(big.analysis).toBeDefined();
    storage.quota = 5_000;
    const saved = addEntry(big);
    expect(saved).not.toBeNull();
    expect(listEntries()[0].analysis).toBeUndefined();
  });
});

describe("export / import", () => {
  beforeEach(() => setHistoryEnabled(true));

  it("round-trips and skips duplicates", () => {
    addEntry(entry({ jobDescription: "A" }));
    addEntry(entry({ jobDescription: "B" }));
    const json = exportHistory();
    expect(JSON.parse(json)).toMatchObject({ app: "fitwise", version: 1 });

    clearHistory();
    expect(importHistory(json)).toEqual({ imported: 2, skipped: 0 });
    expect(importHistory(json)).toEqual({ imported: 0, skipped: 2 });
    expect(listEntries()).toHaveLength(2);
  });

  it("strips unknown fields such as resume text from imports", () => {
    const evil = { ...entry({ jobDescription: "C" }), resumeText: "SECRET RESUME", id: "x1" };
    expect(importHistory(JSON.stringify([evil])).imported).toBe(1);
    expect(storage.getItem(HISTORY_ENTRIES_KEY)).not.toContain("SECRET RESUME");
  });

  it("reports bad files and requires opt-in", () => {
    expect(importHistory("nope").error).toMatch(/JSON/);
    expect(importHistory('{"foo":1}').error).toMatch(/not a Fitwise/);
    setHistoryEnabled(false);
    expect(importHistory("[]").error).toMatch(/Turn history on/);
  });
});

describe("toHistoryEntry", () => {
  it("maps the current analysis shape", () => {
    const e = toHistoryEntry({
      resumeText: RESUME,
      jobDescription: "JD",
      resumeFileName: "cv.pdf",
      analysis: {
        roleTitle: "Data Engineer",
        overallScore: 64.4,
        dimensions: [
          { name: "Keywords", score: 55 },
          { name: "Experience", score: 72 },
        ],
        keywords: [
          { keyword: "Spark", presentInResume: false },
          { keyword: "SQL", presentInResume: true },
        ],
        missingSkills: [{ skill: "Airflow" }, { skill: "spark" }],
        matchedSkills: [{ evidence: "quote from resume" }],
      },
    });
    expect(e.roleTitle).toBe("Data Engineer");
    expect(e.scores).toEqual({ composite: 64, keywordCoverage: 55, evidence: 72 });
    expect(e.missingKeywords).toEqual(["Spark", "Airflow"]);
    expect(e.resumeFileName).toBe("cv.pdf");
    expect(e.analysis).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain(RESUME);
  });

  it("prefers explicit and nested scores, and derives a title", () => {
    const e = toHistoryEntry({
      resumeText: RESUME,
      jobDescription: "\n  Senior PM at Foo\nmore",
      analysis: { scores: { ats: { score: 88 } }, compositeScore: 77 },
      scores: { composite: 50 },
      missingKeywords: ["Roadmaps"],
    });
    expect(e.scores).toEqual({ composite: 50, ats: 88 });
    expect(e.roleTitle).toBe("Senior PM at Foo");
    expect(e.missingKeywords).toEqual(["Roadmaps"]);
  });

  it("reads the analyze response's composite score before a legacy overallScore", () => {
    const e = toHistoryEntry({
      resumeText: RESUME,
      jobDescription: "Backend Engineer\nGo, Postgres",
      analysis: {
        overallScore: 10,
        score: {
          composite: 68,
          components: [
            { id: "keywords", score: 60 },
            { id: "requirements", score: 75 },
            { id: "ats", score: 82 },
          ],
        },
        match: { coverage: { weightedCoveragePct: 61, requiredMissing: ["Postgres"] } },
      },
    });
    expect(e.scores).toEqual({ composite: 68, keywordCoverage: 60, ats: 82, evidence: 75 });
    expect(e.missingKeywords).toEqual(["Postgres"]);
  });

  it("sanitizeEntry clamps scores", () => {
    const e = sanitizeEntry({ jdText: "x", resumeHash: "h", scores: { composite: 140, ats: "n/a" } });
    expect(e?.scores).toEqual({ composite: 100 });
  });
});

describe("compare", () => {
  const make = (role: string, missing: string[], composite?: number): HistoryEntry => ({
    ...entry({ jobDescription: role }),
    roleTitle: role,
    missingKeywords: missing,
    scores: composite === undefined ? {} : { composite },
  });

  it("aggregates keywords missing in at least half", () => {
    const entries = [
      make("A", ["GraphQL", "AWS"]),
      make("B", ["graphql", "Go"]),
      make("C", ["GraphQL", "AWS", "Rust"]),
    ];
    const agg = aggregateMissingKeywords(entries);
    expect(agg.map((a) => [a.keyword, a.count])).toEqual([
      ["GraphQL", 3],
      ["AWS", 2],
    ]);
    expect(agg[0].roles).toEqual(["A", "B", "C"]);
  });

  it("finds the best column and present keys", () => {
    const entries = [make("A", [], 60), make("B", [], 80), make("C", [])];
    expect(bestIndex(entries, "composite")).toBe(1);
    expect(bestIndex([make("A", [], 5), make("B", [], 5)], "composite")).toBe(-1);
    expect(presentScoreKeys(entries)).toEqual(["composite"]);
  });
});
