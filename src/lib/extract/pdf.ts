/**
 * PDF extraction via unpdf (pdf.js), bounded in pages and time, that also
 * reads glyph positions and the drawing operators to find layout risks and
 * text a human cannot see.
 */
import { countGlyphHints } from "./glyphs";
import type { ExtractMeta, HiddenTextFlag, HiddenTextReason } from "./types";

export class PdfError extends Error {}
export class PdfTimeoutError extends PdfError {}

export const PDF_LIMITS = {
  maxPages: 8,
  timeoutMs: 15_000,
  /** Text below this size (pt) is unreadable in print. */
  tinyFontPt: 4,
  /** A page with fewer characters than this counts as having no text. */
  emptyPageChars: 30,
};

export type PdfExtraction = { raw: string; meta: ExtractMeta };

/** Minimal views of pdf.js shapes, so this module does not depend on its types. */
export type PositionedItem = { str: string; x: number; y: number; width: number; fontSize: number };

type OperatorList = { fnArray: number[]; argsArray: unknown[][] };

/* ---------------------------------------------------------------------------
   Column detection
   ------------------------------------------------------------------------- */

type Segment = { x0: number; x1: number };

/** Group items into visual rows, then merge items within a row into segments. */
export function rowsToSegments(items: PositionedItem[]): Segment[][] {
  const visible = items.filter((i) => i.str.trim().length > 0 && i.fontSize > 0);
  const sorted = [...visible].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(2, item.fontSize * 0.35);
    if (row && Math.abs(row[0].y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    const byX = [...row].sort((a, b) => a.x - b.x);
    const segments: Segment[] = [];
    for (const item of byX) {
      const last = segments[segments.length - 1];
      const gapLimit = Math.max(8, item.fontSize * 1.6);
      if (last && item.x - last.x1 <= gapLimit) last.x1 = Math.max(last.x1, item.x + item.width);
      else segments.push({ x0: item.x, x1: item.x + item.width });
    }
    return segments;
  });
}

/**
 * True when a second, left-aligned text column starts at a consistent x in
 * the middle of the page and almost no rows run across it. Right-aligned dates
 * do not trigger this: their start positions vary with their length, and the
 * bullets beside them cross the would-be column boundary.
 */
export function detectColumns(items: PositionedItem[], pageWidth: number): boolean {
  const rows = rowsToSegments(items);
  if (rows.length < 10 || pageWidth <= 0) return false;
  const binSize = pageWidth * 0.015;
  const bins = new Map<number, number>();
  for (const row of rows) {
    for (const seg of row) {
      const rel = seg.x0 / pageWidth;
      if (rel < 0.22 || rel > 0.78) continue;
      const bin = Math.round(seg.x0 / binSize);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestCount = 0;
  for (const [bin, count] of bins) {
    const c = count + (bins.get(bin - 1) ?? 0) + (bins.get(bin + 1) ?? 0);
    if (c > bestCount) {
      bestCount = c;
      best = bin;
    }
  }
  if (best < 0 || bestCount < Math.max(6, rows.length * 0.2)) return false;
  const boundary = best * binSize;
  const crossing = rows.filter((row) =>
    row.some((seg) => seg.x0 < boundary - binSize * 2 && seg.x1 > boundary + binSize * 2),
  ).length;
  return crossing / rows.length < 0.15;
}

/* ---------------------------------------------------------------------------
   Operator scan: fill colour, render mode, images
   ------------------------------------------------------------------------- */

type Ops = Record<string, number>;

function parseFill(arg: unknown): [number, number, number] | null {
  if (typeof arg === "string" && /^#[0-9a-f]{6}$/i.test(arg)) {
    const n = parseInt(arg.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  if (Array.isArray(arg) || ArrayBuffer.isView(arg)) {
    const a = Array.from(arg as ArrayLike<number>);
    if (a.length >= 3) return [a[0], a[1], a[2]].map((v) => (v <= 1 ? v * 255 : v)) as [number, number, number];
  }
  return null;
}

const isNearWhite = (rgb: [number, number, number]) => rgb.every((c) => c >= 240);
const luminance = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function glyphText(glyphs: unknown): string {
  if (!Array.isArray(glyphs)) return "";
  return glyphs
    .map((g) => {
      if (g && typeof g === "object" && "unicode" in g) return String((g as { unicode: unknown }).unicode ?? "");
      if (typeof g === "number" && g < -250) return " ";
      return "";
    })
    .join("");
}

export type OperatorScan = {
  whiteText: string;
  /** Every string drawn by a text operator, visible or not. */
  allText: string;
  invisibleText: string;
  imageCount: number;
  /** Non-white shapes or shadings were painted: white text may sit on a banner. */
  darkPaint: boolean;
};

export function scanOperators(list: OperatorList, OPS: Ops): OperatorScan {
  const textOps = new Set(
    [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].filter(
      (n) => typeof n === "number",
    ),
  );
  const fillOps = new Set(
    [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(
      (n) => typeof n === "number",
    ),
  );
  const imageOps = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup].filter(
      (n) => typeof n === "number",
    ),
  );

  type State = { fill: [number, number, number]; mode: number };
  const stack: State[] = [];
  let state: State = { fill: [0, 0, 0], mode: 0 };
  let whiteText = "";
  let invisibleText = "";
  let allText = "";
  let imageCount = 0;
  let darkPaint = false;

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] ?? [];
    if (fn === OPS.save) stack.push({ ...state });
    else if (fn === OPS.restore) state = stack.pop() ?? { fill: [0, 0, 0], mode: 0 };
    else if (fn === OPS.setFillRGBColor) state.fill = parseFill(args.length === 1 ? args[0] : args) ?? state.fill;
    else if (fn === OPS.setTextRenderingMode) state.mode = Number(args[0]) || 0;
    else if (textOps.has(fn)) {
      const glyphs = fn === OPS.nextLineSetSpacingShowText ? args[2] : args[0];
      const text = glyphText(glyphs);
      if (!text.trim()) continue;
      allText += `${text} `;
      // Modes 3 and 7 draw nothing visible (7 only adds to the clip path).
      if (state.mode === 3 || state.mode === 7) invisibleText += `${text} `;
      else if (isNearWhite(state.fill) && state.mode !== 1 && state.mode !== 5) whiteText += `${text} `;
    } else if (imageOps.has(fn)) {
      imageCount++;
      darkPaint = true;
    } else if (fn === OPS.shadingFill) darkPaint = true;
    else if (fillOps.has(fn) || (fn === OPS.constructPath && fillOps.has(Number(args[0])))) {
      if (luminance(state.fill) < 0.6) darkPaint = true;
    }
  }
  return { whiteText: whiteText.trim(), allText: allText.trim(), invisibleText: invisibleText.trim(), imageCount, darkPaint };
}

/* ---------------------------------------------------------------------------
   Extraction
   ------------------------------------------------------------------------- */

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new PdfTimeoutError("PDF parsing timed out."));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function flagFor(reason: HiddenTextReason, page: number, text: string, confidence: "high" | "low"): HiddenTextFlag {
  const clean = text.replace(/\s+/g, " ").trim();
  return { reason, page, chars: clean.length, sample: clean.slice(0, 160), confidence };
}

function wordsOf(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
}

type TextItem ={ str?: string; transform?: number[]; width?: number; hasEOL?: boolean };

export async function extractPdf(
  bytes: Uint8Array,
  options: { maxPages?: number; timeoutMs?: number } = {},
): Promise<PdfExtraction> {
  const maxPages = options.maxPages ?? PDF_LIMITS.maxPages;
  const timeoutMs = options.timeoutMs ?? PDF_LIMITS.timeoutMs;
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const pdfjs = (await getResolvedPDFJS()) as unknown as { OPS: Ops };
  const OPS = pdfjs.OPS;

  // pdf.js may transfer (detach) the buffer it is given, so it gets a copy.
  const document = await withTimeout(
    getDocumentProxy(bytes.slice(), {
      // pdf.js v5 (bundled by unpdf) no longer evaluates font programs with eval,
      // so the old isEvalSupported:false hardening flag no longer exists.
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    }),
    timeoutMs,
    () => {},
  );

  const work = async (): Promise<PdfExtraction> => {
    const pages = document.numPages;
    const pagesProcessed = Math.min(pages, maxPages);
    const pageTexts: string[] = [];
    const hiddenTextFlags: HiddenTextFlag[] = [];
    const multiColumnPages: number[] = [];
    const emptyPages: number[] = [];
    const imageOnlyPages: number[] = [];

    for (let p = 1; p <= pagesProcessed; p++) {
      const page = await document.getPage(p);
      const [vx0, vy0, vx1, vy1] = page.view as number[];
      const width = vx1 - vx0;
      const height = vy1 - vy0;
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((i) => typeof i.str === "string");
      pageTexts.push(items.map((i) => `${i.str}${i.hasEOL ? "\n" : ""}`).join(""));

      const positioned: PositionedItem[] = items.map((i) => {
        const [, , c = 0, d = 0, e = 0, f = 0] = i.transform ?? [];
        return { str: i.str ?? "", x: e - vx0, y: f - vy0, width: i.width ?? 0, fontSize: Math.hypot(c, d) };
      });

      const tiny = positioned.filter((i) => i.str.trim() && i.fontSize > 0 && i.fontSize < PDF_LIMITS.tinyFontPt);
      const ops = (await page.getOperatorList()) as unknown as OperatorList;
      const scan = scanOperators(ops, OPS);
      const textChars = pageTexts[p - 1].replace(/\s+/g, "").length;

      // pdf.js silently drops text positioned outside the page box from
      // getTextContent, so off-page text is whatever the drawing operators
      // show that the text layer does not contain. Other parsers may read it.
      const contentWords = new Set(wordsOf(pageTexts[p - 1]));
      const offPageWords = wordsOf(scan.allText).filter((w) => !contentWords.has(w));
      const partlyOff = positioned.filter(
        (i) => i.str.trim() && (i.x > width + 2 || i.x + i.width < -2 || i.y < -2 || i.y > height + 2),
      );
      const offPage = [...partlyOff.map((i) => i.str), ...offPageWords].join(" ");

      if (tiny.length) hiddenTextFlags.push(flagFor("tiny-font", p, tiny.map((i) => i.str).join(" "), "high"));
      if (offPage.replace(/\s+/g, "").length >= 8) hiddenTextFlags.push(flagFor("off-page", p, offPage, "high"));
      if (scan.whiteText) {
        hiddenTextFlags.push(flagFor("white-text", p, scan.whiteText, scan.darkPaint ? "low" : "high"));
      }
      if (scan.invisibleText) {
        // An invisible layer over a scanned image is how OCR'd PDFs work.
        hiddenTextFlags.push(flagFor("invisible-render", p, scan.invisibleText, scan.imageCount > 0 ? "low" : "high"));
      }

      const visibleChars = textChars - (scan.imageCount > 0 ? scan.invisibleText.replace(/\s+/g, "").length : 0);
      if (visibleChars < PDF_LIMITS.emptyPageChars) {
        if (scan.imageCount > 0) imageOnlyPages.push(p);
        else emptyPages.push(p);
      }
      if (detectColumns(positioned, width)) multiColumnPages.push(p);
      page.cleanup();
    }

    const raw = pageTexts
      .join("\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    return {
      raw,
      meta: {
        kind: "pdf",
        pages,
        pagesProcessed,
        pageTextLengths: pageTexts.map((t) => t.replace(/\s+/g, " ").trim().length),
        hiddenTextFlags,
        layoutHints: {
          likelyMultiColumn: multiColumnPages.length > 0,
          multiColumnPages,
          emptyPages,
          imageOnlyPages,
          ...countGlyphHints(raw),
        },
      },
    };
  };

  try {
    return await withTimeout(work(), timeoutMs, () => {
      void document.loadingTask.destroy().catch(() => {});
    });
  } finally {
    // pdf.js keeps the parsed document alive until it is destroyed; on a warm
    // serverless instance that would accumulate with every upload.
    await document.loadingTask.destroy().catch(() => {});
  }
}
