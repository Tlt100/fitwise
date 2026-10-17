/**
 * Curated action verbs (past tense, as resume bullets are conventionally
 * written). Present-tense and -ing forms are recognised by `baseVerb`.
 */
export const STRONG_VERBS: ReadonlySet<string> = new Set([
  // Leadership
  "led", "directed", "headed", "managed", "supervised", "mentored", "coached",
  "championed", "spearheaded", "orchestrated", "steered", "chaired", "guided",
  "mobilized", "rallied", "hired", "recruited", "trained", "onboarded", "delegated",
  "oversaw", "owned", "drove", "galvanized", "empowered", "unified",
  // Building and creating
  "built", "created", "designed", "developed", "engineered", "architected",
  "launched", "shipped", "implemented", "established", "founded", "pioneered",
  "prototyped", "programmed", "coded", "authored", "wrote", "composed", "produced",
  "devised", "formulated", "initiated", "instituted", "introduced", "invented",
  "constructed", "assembled", "configured", "deployed", "integrated", "installed",
  "released", "published", "drafted", "crafted", "modeled", "modelled", "mapped",
  // Improving
  "improved", "increased", "accelerated", "boosted", "enhanced", "optimized",
  "optimised", "streamlined", "upgraded", "modernized", "modernised", "refactored",
  "revamped", "redesigned", "rebuilt", "restructured", "reengineered", "overhauled",
  "transformed", "strengthened", "expanded", "scaled", "maximized", "elevated",
  "refined", "revitalized", "standardized", "automated", "simplified", "consolidated",
  "migrated", "converted", "stabilized", "hardened", "tuned",
  // Reducing
  "reduced", "cut", "decreased", "lowered", "minimized", "eliminated", "slashed",
  "trimmed", "saved", "conserved", "resolved", "fixed", "debugged", "remediated",
  "mitigated", "prevented", "averted", "contained", "recovered", "rescued",
  // Results and wins
  "achieved", "delivered", "exceeded", "surpassed", "outperformed", "won", "earned",
  "secured", "attained", "completed", "generated", "grew", "doubled", "tripled",
  "captured", "closed", "landed", "negotiated", "sold", "acquired", "raised",
  "converted", "retained", "ranked", "awarded", "realized",
  // Analysis and research
  "analyzed", "analysed", "assessed", "audited", "evaluated", "investigated",
  "researched", "measured", "quantified", "forecasted", "forecast", "identified",
  "diagnosed", "discovered", "examined", "benchmarked", "tested", "validated",
  "verified", "surveyed", "calculated", "computed", "modeled", "predicted",
  "uncovered", "inspected", "monitored", "tracked", "profiled", "experimented",
  // Communication and influence
  "presented", "persuaded", "influenced", "advocated", "pitched", "briefed",
  "communicated", "convinced", "educated", "lectured", "taught", "facilitated",
  "mediated", "moderated", "partnered", "collaborated", "liaised", "negotiated",
  "documented", "translated", "edited", "reported", "advised", "consulted",
  "promoted", "marketed", "campaigned", "publicized", "represented", "demonstrated",
  // Organizing and operating
  "coordinated", "organized", "organised", "planned", "scheduled", "prioritized",
  "administered", "operated", "executed", "ran", "processed", "maintained",
  "allocated", "budgeted", "procured", "sourced", "curated", "cataloged",
  "catalogued", "systematized", "centralized", "dispatched", "triaged", "served",
  "supported", "resourced", "piloted", "set",
  // Financial
  "invested", "funded", "financed", "audited", "reconciled", "underwrote", "priced",
]);

/** Irregular present → past, so "Lead the team" and "Build X" are recognised. */
const IRREGULAR: Record<string, string> = {
  lead: "led", leads: "led", leading: "led",
  build: "built", builds: "built", building: "built",
  drive: "drove", drives: "drove", driving: "drove",
  write: "wrote", writes: "wrote", writing: "wrote",
  run: "ran", runs: "ran", running: "ran",
  grow: "grew", grows: "grew", growing: "grew",
  win: "won", wins: "won", winning: "won",
  teach: "taught", teaches: "taught", teaching: "taught",
  sell: "sold", sells: "sold", selling: "sold",
  oversee: "oversaw", oversees: "oversaw", overseeing: "oversaw",
  underwrite: "underwrote",
  cut: "cut", cuts: "cut", cutting: "cut",
  set: "set", sets: "set", setting: "set",
  forecast: "forecast",
};

/** Normalise a first word to the form used in STRONG_VERBS, or null. */
export function baseVerb(word: string): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  if (STRONG_VERBS.has(w)) return w;
  if (IRREGULAR[w] && STRONG_VERBS.has(IRREGULAR[w])) return IRREGULAR[w];
  const candidates: string[] = [];
  if (w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    candidates.push(`${stem}ed`, `${stem}d`, `${stem}ied`, `${stem.slice(0, -1)}ed`, `${stem}eed`);
    // "designing" → "designed", "optimizing" → "optimized", "planning" → "planned"
  }
  if (w.endsWith("ies")) candidates.push(`${w.slice(0, -3)}ied`);
  if (w.endsWith("es")) candidates.push(`${w.slice(0, -2)}ed`, `${w.slice(0, -1)}d`);
  if (w.endsWith("s")) candidates.push(`${w.slice(0, -1)}ed`, `${w.slice(0, -1)}d`);
  if (w.endsWith("y")) candidates.push(`${w.slice(0, -1)}ied`);
  if (w.endsWith("e")) candidates.push(`${w}d`);
  // "plan" → "planned", "ship" → "shipped"
  candidates.push(`${w}ed`, `${w}${w.slice(-1)}ed`);
  for (const c of candidates) if (STRONG_VERBS.has(c)) return c;
  return null;
}

/** Weak openers, longest first so "was responsible for" wins over "was". */
export const WEAK_OPENERS: readonly string[] = [
  "was responsible for",
  "responsible for",
  "duties included",
  "duties include",
  "tasks included",
  "job duties",
  "in charge of",
  "tasked with",
  "involved in",
  "participated in",
  "helped to",
  "helped with",
  "helped",
  "helping",
  "assisted with",
  "assisted in",
  "assisted",
  "assisting",
  "worked on",
  "worked with",
  "worked",
  "working on",
  "contributed to",
  "exposure to",
  "familiar with",
  "experience with",
  "experience in",
  "attended",
  "tried",
  "did",
  "was",
  "were",
  "made",
  "got",
];

export const BUZZWORDS: readonly string[] = [
  "synergy",
  "synergies",
  "synergize",
  "go-getter",
  "team player",
  "hard worker",
  "hard-working",
  "hardworking",
  "detail-oriented",
  "detail oriented",
  "results-driven",
  "results driven",
  "results-oriented",
  "self-starter",
  "self starter",
  "think outside the box",
  "outside the box",
  "out-of-the-box",
  "dynamic",
  "highly motivated",
  "motivated",
  "passionate",
  "guru",
  "ninja",
  "rockstar",
  "rock star",
  "best-of-breed",
  "best of breed",
  "value add",
  "value-add",
  "go-to person",
  "thought leader",
  "seasoned",
  "strategic thinker",
  "excellent communication skills",
  "fast-paced",
  "fast paced",
  "wear many hats",
  "move the needle",
  "game changer",
  "game-changer",
  "world-class",
  "cutting-edge",
  "bleeding-edge",
  "proven track record",
  "track record of success",
  "various",
  "etc.",
];
