/**
 * Tokenisation and light stemming shared by the keyword engine and the
 * grounding verifier. Pure functions, no dependencies: this runs in the browser
 * and on the server and must give the same answer in both.
 *
 * The tokeniser keeps the characters that make technical names distinct
 * ("C++", "C#", ".NET", "Node.js", "R&D", "P&L") inside a token, and splits on
 * hyphens and slashes so "cross-functional" and "cross functional", or
 * "CI/CD" and "CI CD", produce the same token sequence. Every term in the
 * lexicon is run through the same tokeniser, so both sides always agree.
 */

export interface Token {
  /** The token exactly as written (after Unicode normalisation). */
  raw: string;
  /** Lower-cased, possessive stripped. Used for "exact" comparisons. */
  norm: string;
  /** Light stem of `norm`. Used for lookup, so plurals and tenses meet. */
  stem: string;
  /** Character offsets into the normalised text. */
  start: number;
  end: number;
  /** Zero-based line number. */
  line: number;
  /** First token of a line, sentence or bullet. */
  sentenceStart: boolean;
  /** Immediately followed by a hyphen ("Go-to-market", "C-suite"). */
  hyphenAfter: boolean;
  /** Immediately followed by a period ("John R. Smith"). */
  periodAfter: boolean;
  /**
   * Only spaces, hyphens or slashes separate this token from the previous one
   * on the same line, so the two can belong to one phrase. False after a comma,
   * bracket, colon, full stop or line break: "AWS (S3" is not "AWS S3".
   */
  joinsPrevious: boolean;
}

/**
 * Canonicalise Unicode so the same word typed on two keyboards (or extracted
 * from two PDF generators) compares equal: compatibility forms, curly quotes,
 * typographic dashes, non-breaking spaces and zero-width characters.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\r\n?/g, "\n");
}

/*
 * A token starts with an optional dot (only kept for ".NET"), then an
 * alphanumeric, then any run of alphanumerics and + # & . ' that does not end
 * on a dot, ampersand or apostrophe. So "Node.js." yields "Node.js" and
 * "C++," yields "C++".
 */
const TOKEN_RE = /\.?[A-Za-z0-9](?:[A-Za-z0-9+#&.']*[A-Za-z0-9+#])?/g;

const SENTENCE_BREAK = new Set([".", "!", "?", ";", "•", "●", "▪", "◦", "*", "-", "·", ">", "|", "‣", "⁃"]);

export function tokenize(input: string): Token[] {
  const text = normalizeText(input);
  const tokens: Token[] = [];
  let line = 0;
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    let raw = match[0];
    let start = match.index ?? 0;
    for (let i = lastIndex; i < start; i += 1) if (text[i] === "\n") line += 1;
    lastIndex = start;

    // A leading dot only belongs to the token in ".NET"; anywhere else it is
    // the tail of an ellipsis or a sentence glued to the next word.
    if (raw.startsWith(".") && !/^\.net$/i.test(raw)) {
      raw = raw.slice(1);
      start += 1;
      if (!raw) continue;
    }
    const end = start + raw.length;

    let j = start - 1;
    while (j >= 0 && (text[j] === " " || text[j] === "\t")) j -= 1;
    const prev = j >= 0 ? text[j] : "\n";
    // A hyphen glued to the previous word ("cross-functional") joins words; a
    // free-standing one ("- Go and Rust") is a bullet.
    const gluedHyphen = prev === "-" && j > 0 && /[A-Za-z0-9]/.test(text[j - 1]);
    const sentenceStart =
      prev === "\n" ||
      (SENTENCE_BREAK.has(prev) && !gluedHyphen) ||
      (prev === "(" && tokens.length === 0);

    const norm = normalizeWord(raw);
    // Plural acronyms ("APIs", "KPIs", "LLMs") stem to the singular.
    const acronymPlural = /^[A-Z][A-Z0-9]+s$/.test(raw);
    tokens.push({
      raw,
      norm,
      stem: acronymPlural ? norm.slice(0, -1) : stem(norm),
      start,
      end,
      line,
      sentenceStart,
      hyphenAfter: text[end] === "-",
      periodAfter: text[end] === ".",
      joinsPrevious:
        tokens.length > 0 && /^[ \t\-/]*$/.test(text.slice(tokens[tokens.length - 1].end, start)),
    });
  }

  return tokens;
}

/** Lower-case and drop a trailing possessive ("company's" -> "company"). */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/'s$/, "").replace(/'$/, "");
}

const VOWEL = /[aeiouy]/;

/**
 * A deliberately light English stemmer. It only has to make inflections of the
 * same word meet ("pipelines"/"pipeline", "managing"/"managed"/"manage",
 * "technologies"/"technology", "optimise"/"optimize"); it never has to produce
 * a real word. Tokens containing digits or symbols are returned untouched, so
 * "C++", "S3", "Node.js" and "ISO 27001" are never mangled.
 */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length <= 3) return w;

  // British -ise spellings fold onto -ize before anything else.
  if (w.length > 5) {
    w = w
      .replace(/isation$/, "ization")
      .replace(/ising$/, "izing")
      .replace(/ised$/, "ized")
      .replace(/ises$/, "izes")
      .replace(/ise$/, "ize");
  }

  if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "y";
  } else if (w.endsWith("ied") && w.length > 4) {
    w = w.slice(0, -3) + "y";
  } else if (
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is") &&
    w.length > 3
  ) {
    w = w.slice(0, -1);
  }

  if (w.endsWith("ing") && w.length - 3 >= 3 && VOWEL.test(w.slice(0, -3))) {
    w = w.slice(0, -3);
  } else if (
    w.endsWith("ed") &&
    !w.endsWith("eed") &&
    w.length - 2 >= 3 &&
    VOWEL.test(w.slice(0, -2))
  ) {
    w = w.slice(0, -2);
  }

  if (w.endsWith("e") && w.length > 3) w = w.slice(0, -1);

  // Undouble a final consonant pair so "planning" -> "plan", "install" -> "instal".
  const last = w[w.length - 1];
  if (
    w.length > 3 &&
    last === w[w.length - 2] &&
    !VOWEL.test(last) &&
    last !== "s"
  ) {
    w = w.slice(0, -1);
  }

  return w;
}

/** The lookup key for a phrase: its token stems joined by single spaces. */
export function stemKey(phrase: string): string {
  return tokenize(phrase)
    .map((t) => t.stem)
    .join(" ");
}

/** The exact-comparison key for a phrase: lower-cased tokens joined by spaces. */
export function normKey(phrase: string): string {
  return tokenize(phrase)
    .map((t) => t.norm)
    .join(" ");
}

/** Function words ignored when comparing quotes and when mining candidates. */
export const STOPWORDS = new Set(
  (
    "a an and are as at be been being but by can could did do does for from had has have " +
    "he her him his how i if in into is it its me my no not of on or our ours she so " +
    "than that the their them then there these they this those to too up us was we were " +
    "what when where which while who whom why will with would you your yours also very " +
    "via per over under about across after before between during through within without"
  ).split(" "),
);
