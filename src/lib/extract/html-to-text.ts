/**
 * Flatten mammoth's HTML to plain text. mammoth's raw-text mode drops list
 * markers, so bullets would be indistinguishable from paragraphs; going via
 * HTML keeps them as "- " lines, which the bullet linter and the model both use.
 * mammoth emits a small, well-formed tag set, so a tokenising pass is enough.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:li|p|h[1-6]|ul|ol|table|tr|td|th|div|blockquote)>/gi, "\n")
      // Opening block tags add nothing: the closing tag already ends the line,
      // so consecutive paragraphs come out one per line, not double-spaced.
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    // "- " on its own line happens when an <li> starts with a nested <p>.
    .replace(/^-\n+(?=\S)/gm, "- ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
