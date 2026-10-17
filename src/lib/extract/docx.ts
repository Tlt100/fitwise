/**
 * DOCX extraction with upload hardening and layout signals. The ZIP is
 * validated and every entry is test-inflated under a hard cap before mammoth
 * ever sees it; the raw WordprocessingML is then scanned for the structures
 * ATS parsers stumble on (tables, text boxes, headers/footers, hidden runs).
 */
import { countGlyphHints } from "./glyphs";
import { htmlToText, decodeEntities } from "./html-to-text";
import type { ExtractMeta, HiddenTextFlag } from "./types";
import { ZipError, readCentralDirectory, readEntry, verifyAllEntries, type ZipEntry } from "./zip";

export class DocxError extends Error {}

export type DocxExtraction = { raw: string; meta: ExtractMeta };

const decoder = new TextDecoder();

function entryText(bytes: Uint8Array, entry: ZipEntry | undefined): string {
  return entry ? decoder.decode(readEntry(bytes, entry)) : "";
}

/** Text of all <w:t> runs in a fragment of WordprocessingML. */
export function wordText(xml: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) parts.push(decodeEntities(m[1]));
    else if (m[0] === "<w:tab/>") parts.push(" ");
    else parts.push("\n");
  }
  return parts.join("").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** Top-level <w:tbl> ranges (nested tables are inside their parent's range). */
function tableRanges(xml: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /<w:tbl>|<w:tbl\s[^>]*>|<\/w:tbl>/g;
  let depth = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0] === "</w:tbl>") {
      depth--;
      if (depth === 0) ranges.push([start, m.index + m[0].length]);
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return ranges;
}

function isNearWhite(hex: string): boolean {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return r >= 0xf0 && g >= 0xf0 && b >= 0xf0;
}

function isOn(attr: string | undefined): boolean {
  return attr === undefined || !/^(?:0|false|off)$/i.test(attr);
}

export function scanHiddenRuns(xml: string): HiddenTextFlag[] {
  // Dark paragraph/cell shading anywhere makes white text plausibly intentional.
  const darkShading = /<w:shd\b[^>]*w:fill="(?!auto|FFFFFF|ffffff)([0-9A-Fa-f]{6})"/.exec(xml);
  const hasDarkBackground = darkShading ? !isNearWhite(darkShading[1]) : false;

  const buckets: Record<"hidden-run" | "white-text" | "tiny-font", string[]> = {
    "hidden-run": [],
    "white-text": [],
    "tiny-font": [],
  };
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml))) {
    const body = m[1];
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1];
    if (!rPr) continue;
    const text = wordText(body);
    if (!text.trim()) continue;
    const vanish = /<w:vanish(?:\s+w:val="([^"]*)")?\s*\/>/.exec(rPr);
    if (vanish && isOn(vanish[1])) {
      buckets["hidden-run"].push(text);
      continue;
    }
    const color = /<w:color\s+w:val="([0-9A-Fa-f]{6})"/.exec(rPr);
    if (color && isNearWhite(color[1])) {
      buckets["white-text"].push(text);
      continue;
    }
    const size = /<w:sz\s+w:val="(\d+)"/.exec(rPr);
    // w:sz is in half-points: 8 = 4pt.
    if (size && Number(size[1]) < 8) buckets["tiny-font"].push(text);
  }

  const flags: HiddenTextFlag[] = [];
  for (const [reason, texts] of Object.entries(buckets) as Array<[keyof typeof buckets, string[]]>) {
    if (texts.length === 0) continue;
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    flags.push({
      reason,
      chars: joined.length,
      sample: joined.slice(0, 160),
      confidence: reason === "white-text" && hasDarkBackground ? "low" : "high",
    });
  }
  return flags;
}

export function inspectDocx(bytes: Uint8Array): {
  entries: ZipEntry[];
  documentXml: string;
  headerFooterText: string;
} {
  let entries: ZipEntry[];
  try {
    entries = readCentralDirectory(bytes);
  } catch (error) {
    throw new DocxError(error instanceof ZipError ? error.message : "Invalid ZIP archive.");
  }
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new DocxError("Not a Word document: word/document.xml is missing.");

  try {
    verifyAllEntries(bytes, entries);
  } catch (error) {
    throw new DocxError(error instanceof ZipError ? error.message : "Archive failed verification.");
  }

  const documentXml = entryText(bytes, doc);
  const headerFooterText = entries
    .filter((e) => /^word\/(?:header|footer)\d*\.xml$/.test(e.name))
    .map((e) => wordText(entryText(bytes, e)))
    .filter(Boolean)
    .join("\n")
    .trim();
  return { entries, documentXml, headerFooterText };
}

export function docxLayout(documentXml: string) {
  const tables = tableRanges(documentXml);
  const totalText = wordText(documentXml).replace(/\s+/g, "").length;
  const tableText = tables
    .map(([a, b]) => wordText(documentXml.slice(a, b)).replace(/\s+/g, "").length)
    .reduce((s, n) => s + n, 0);
  // Word writes each text box twice (DrawingML plus a VML fallback); count one.
  const withoutFallback = documentXml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const textBoxes = (withoutFallback.match(/<w:txbxContent\b/g) ?? []).length;
  // Newspaper-style section columns (Layout > Columns in Word).
  const multiColumn = /<w:cols\b[^>]*w:num="(?:[2-9]|1\d)"/.test(documentXml);
  return {
    multiColumn,
    tableCount: tables.length,
    tableTextRatio: totalText ? Math.round((tableText / totalText) * 100) / 100 : 0,
    textBoxes,
  };
}

export async function extractDocx(bytes: Uint8Array): Promise<DocxExtraction> {
  const { documentXml, headerFooterText } = inspectDocx(bytes);
  const layout = docxLayout(documentXml);
  const hiddenTextFlags = scanHiddenRuns(documentXml);

  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    // Images are irrelevant to the text and would otherwise be inlined as base64.
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  const raw = htmlToText(html);

  const meta: ExtractMeta = {
    kind: "docx",
    hasTables: layout.tableCount > 0,
    tableCount: layout.tableCount,
    tableTextRatio: layout.tableTextRatio,
    headerFooterText: headerFooterText || undefined,
    hiddenTextFlags,
    layoutHints: {
      likelyMultiColumn: layout.multiColumn,
      textBoxes: layout.textBoxes,
      ...countGlyphHints(raw),
    },
  };
  return { raw, meta };
}
