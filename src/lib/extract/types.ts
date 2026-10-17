/**
 * Shapes shared by the extract route, the deterministic checks and the UI.
 * Nothing here imports Node APIs, so client components can import the types.
 */
import type { AtsReport } from "@/lib/ats/types";
import type { BulletLintReport } from "@/lib/lint/bullets";

export type ResumeFileKind = "pdf" | "docx";

/** Where the text came from. "text" covers a resume pasted straight into the app. */
export type SourceKind = ResumeFileKind | "text";

export type HiddenTextReason =
  /** Rendered smaller than 4pt: unreadable to a person, read in full by a parser. */
  | "tiny-font"
  /** White or near-white fill colour. */
  | "white-text"
  /** Positioned outside the visible page box. */
  | "off-page"
  /** PDF text render mode 3 (neither filled nor stroked). */
  | "invisible-render"
  /** DOCX run marked hidden (w:vanish). */
  | "hidden-run";

export type HiddenTextFlag = {
  reason: HiddenTextReason;
  /** 1-based page number for PDFs; omitted for DOCX. */
  page?: number;
  /** Characters of hidden text found for this reason (on this page). */
  chars: number;
  /** First ~160 characters, so the user can see what was found. */
  sample: string;
  /**
   * "low" when there is a plausible innocent explanation: white text on a page
   * that also paints dark shapes or images (a coloured banner), or invisible
   * text on a scanned page (an OCR layer).
   */
  confidence: "high" | "low";
};

export type LayoutHints = {
  /** Two text columns detected from glyph positions (PDF only). */
  likelyMultiColumn: boolean;
  /** Pages (1-based) where a second column was detected. */
  multiColumnPages?: number[];
  /** Private-use-area code points: usually icon fonts (Font Awesome etc.). */
  privateUseGlyphs: number;
  /** U+FFFD and "(cid:123)" artifacts: glyphs the extractor could not map to text. */
  unmappedGlyphs: number;
  /** Decorative symbols used as bullets or icons (✓ ➢ ★ ☎ ✉ …). */
  iconGlyphs: number;
  /** Pages with almost no text and no images (PDF). */
  emptyPages?: number[];
  /** Pages with almost no text but at least one image: likely a scan (PDF). */
  imageOnlyPages?: number[];
  /** DOCX text boxes / shapes with text (w:txbxContent). */
  textBoxes?: number;
};

export type ExtractMeta = {
  kind: SourceKind;
  /** Total pages in the PDF (not just those processed). */
  pages?: number;
  /** Pages actually read; PDFs are capped to keep parsing bounded. */
  pagesProcessed?: number;
  /** Characters of text found on each processed page. */
  pageTextLengths?: number[];
  /** DOCX: at least one Word table in the body. */
  hasTables?: boolean;
  tableCount?: number;
  /** DOCX: share of body text (0–1) that sits inside tables. */
  tableTextRatio?: number;
  /** DOCX: text found in Word headers/footers, which many ATS (and mammoth) skip. */
  headerFooterText?: string;
  hiddenTextFlags?: HiddenTextFlag[];
  layoutHints: LayoutHints;
};

/** Original response fields, kept unchanged for the current UI. */
export type ExtractSuccessLegacy = {
  text: string;
  words: number;
  characters: number;
  kind: ResumeFileKind;
};

export type ExtractResponse = ExtractSuccessLegacy & {
  meta: ExtractMeta;
  ats: AtsReport;
  bullets: BulletLintReport;
};

export type ExtractError = { error: string };

export function emptyLayoutHints(): LayoutHints {
  return { likelyMultiColumn: false, privateUseGlyphs: 0, unmappedGlyphs: 0, iconGlyphs: 0 };
}
