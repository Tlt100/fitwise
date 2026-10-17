/**
 * Glyph-level signals that only exist in the raw extractor output: once text is
 * normalised, icon fonts and unmapped glyphs are either stripped or flattened.
 */

// Private Use Area (BMP plus the two supplementary planes).
const PRIVATE_USE = /[-]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu;
const UNMAPPED = /�|\(cid:\d+\)/g;
/**
 * Dingbats, arrows, geometric shapes, misc symbols and pictographic emoji —
 * the characters resume templates use for phone/email icons and fancy bullets.
 * The plain bullet "•" and en/em dashes are deliberately not counted: every
 * parser handles those.
 */
const ICONS =
  /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]|[\u{1F300}-\u{1FAFF}]/gu;

export type GlyphHints = {
  privateUseGlyphs: number;
  unmappedGlyphs: number;
  iconGlyphs: number;
};

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function countGlyphHints(raw: string): GlyphHints {
  return {
    privateUseGlyphs: count(raw, PRIVATE_USE),
    unmappedGlyphs: count(raw, UNMAPPED),
    iconGlyphs: count(raw, ICONS),
  };
}
