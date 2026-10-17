import type { HistoryEntry, HistoryScores } from "@/lib/history/store";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 5;

export interface MissingKeywordAggregate {
  /** Display form: the first spelling seen. */
  keyword: string;
  count: number;
  /** count / number of postings compared, 0..1. */
  share: number;
  /** Role titles of the postings that list it. */
  roles: string[];
}

/**
 * Keywords missing across the compared postings, most common first.
 * `minShare` 0.5 means "missing in at least half of these postings".
 */
export function aggregateMissingKeywords(
  entries: HistoryEntry[],
  minShare = 0.5,
): MissingKeywordAggregate[] {
  if (entries.length === 0) return [];
  const map = new Map<string, MissingKeywordAggregate>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const raw of entry.missingKeywords) {
      const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const current = map.get(key) ?? { keyword: raw.trim(), count: 0, share: 0, roles: [] };
      current.count += 1;
      current.roles.push(entry.roleTitle);
      map.set(key, current);
    }
  }
  const needed = Math.max(1, Math.ceil(entries.length * minShare));
  return [...map.values()]
    .map((agg) => ({ ...agg, share: agg.count / entries.length }))
    .filter((agg) => agg.count >= needed)
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}

export const SCORE_LABELS: Record<keyof HistoryScores, string> = {
  composite: "Overall",
  keywordCoverage: "Keyword coverage",
  ats: "ATS readability",
  evidence: "Evidence",
};

/** Score keys that at least one compared entry has a value for. */
export function presentScoreKeys(entries: HistoryEntry[]): (keyof HistoryScores)[] {
  return (Object.keys(SCORE_LABELS) as (keyof HistoryScores)[]).filter((key) =>
    entries.some((e) => typeof e.scores[key] === "number"),
  );
}

/** Index of the best entry for a score key, or -1 when tied or absent. */
export function bestIndex(entries: HistoryEntry[], key: keyof HistoryScores): number {
  let best = -1;
  let bestValue = -Infinity;
  let tie = false;
  entries.forEach((entry, index) => {
    const value = entry.scores[key];
    if (typeof value !== "number") return;
    if (value > bestValue) {
      bestValue = value;
      best = index;
      tie = false;
    } else if (value === bestValue) {
      tie = true;
    }
  });
  return tie ? -1 : best;
}
