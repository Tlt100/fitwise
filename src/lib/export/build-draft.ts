export interface AppliedRewrite {
  original: string;
  replacement: string;
}

/**
 * Produce a revised resume by substituting accepted rewrites into the extracted
 * text. The uploaded file is never touched — this builds a new string that the
 * user exports as a separate document.
 *
 * Matching is deliberately forgiving about whitespace and leading bullet
 * glyphs, because the extractor's line breaks rarely match the model's quoting
 * character for character. It is not forgiving about content: if the original
 * cannot be located, the rewrite is reported as unapplied rather than guessed
 * into place.
 */

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripBullet(value: string): string {
  return value.replace(/^[\s\-*•·–—]+/, "");
}

export interface DraftResult {
  text: string;
  applied: string[];
  unapplied: string[];
}

export function buildDraft(
  resumeText: string,
  rewrites: AppliedRewrite[],
): DraftResult {
  const lines = resumeText.split("\n");
  const applied: string[] = [];
  const unapplied: string[] = [];
  const rewritten = new Set<number>();

  for (const rewrite of rewrites) {
    const target = collapse(stripBullet(rewrite.original));
    if (!target) {
      unapplied.push(rewrite.original);
      continue;
    }

    // An exact line beats a line that merely contains the text, and a line
    // already rewritten is off limits: otherwise a second rewrite whose
    // original is a substring of the first would overwrite it, or land on an
    // earlier line that happens to contain the same words.
    const candidates = lines.map((line) => collapse(stripBullet(line)));
    let index = candidates.findIndex(
      (candidate, i) => !rewritten.has(i) && candidate === target,
    );
    if (index === -1) {
      index = candidates.findIndex(
        (candidate, i) => !rewritten.has(i) && candidate.length > 0 && candidate.includes(target),
      );
    }

    if (index === -1) {
      unapplied.push(rewrite.original);
      continue;
    }

    // Keep whatever prefix the document already used, so a bullet stays a bullet.
    const prefix = lines[index].match(/^[\s\-*•·–—]+/)?.[0] ?? "";
    lines[index] = `${prefix}${stripBullet(rewrite.replacement).trim()}`;
    rewritten.add(index);
    applied.push(rewrite.original);
  }

  return { text: lines.join("\n"), applied, unapplied };
}

/** Split a plain-text resume into paragraph-ish blocks for document export. */
export function toParagraphs(text: string): string[] {
  return text.split("\n").map((line) => line.trimEnd());
}
