import { MAX_RESUME_CHARS } from "@/lib/limits";

// PDF text layers commonly carry ligatures and typographic punctuation that
// look fine on screen but corrupt keyword matching ("workﬂow" !== "workflow").
// Written as escapes so invisible and look-alike characters stay reviewable.
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, "-"],
  [/…/g, "..."],
  [/[•●▪·‣⁃]/g, "- "],
  [/ /g, " "],
];

/**
 * Turn raw extractor output into something a model can read: consistent
 * characters, no control junk, collapsed blank runs, and a hard length cap.
 */
export function normalizeExtractedText(raw: string): string {
  let text = raw.normalize("NFKC");

  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text
    // Zero-width characters, BOMs and soft hyphens are invisible in the
    // preview but split words, so a soft-hyphenated "Kuber-netes" never matches.
    .replace(/[­​-‍⁠﻿]/g, "")
    // Private-use code points are icon-font glyphs (phone, envelope, pin):
    // they render as boxes in plain text and carry no words. The ATS checks
    // count them from the raw extractor output before this runs.
    .replace(/[-]/g, "")
    // Strip control characters but keep newline, carriage return and tab.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    // Trailing spaces make diffing and bullet comparison noisy.
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    // Three or more blank lines carry no information.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > MAX_RESUME_CHARS) {
    // The notice counts toward the cap: the analyze and chat routes reject
    // resume text longer than MAX_RESUME_CHARS, so a truncated resume that
    // overshot it by the length of the notice could never be analysed.
    const notice = `\n\n[Truncated at ${MAX_RESUME_CHARS.toLocaleString("en-US")} characters.]`;
    text = `${text.slice(0, MAX_RESUME_CHARS - notice.length).trimEnd()}${notice}`;
  }

  return text;
}

/** Rough word count, used to tell a real resume from an empty text layer. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);
  return matches ? matches.length : 0;
}
