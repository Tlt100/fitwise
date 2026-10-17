/**
 * Server-side orchestration: file bytes → normalised text + layout metadata →
 * deterministic reports. Node-only (zlib, pdf.js), so import it from routes only.
 */
import { runAtsChecks } from "@/lib/ats/checks";
import { lintBullets } from "@/lib/lint/bullets";
import { extractDocx } from "./docx";
import { countWords, normalizeExtractedText } from "./normalize";
import { extractPdf } from "./pdf";
import type { ExtractMeta, ExtractResponse, ResumeFileKind } from "./types";

export { DocxError } from "./docx";
export { PdfError, PdfTimeoutError } from "./pdf";

export async function extractResumeFile(
  bytes: Uint8Array,
  kind: ResumeFileKind,
): Promise<{ text: string; meta: ExtractMeta }> {
  const { raw, meta } = kind === "pdf" ? await extractPdf(bytes) : await extractDocx(bytes);
  return { text: normalizeExtractedText(raw), meta };
}

/** Build the full response body from extracted text. Pure: usable for pasted text too. */
export function buildExtractResponse(
  text: string,
  meta: ExtractMeta & { kind: ResumeFileKind },
  now: Date = new Date(),
): ExtractResponse {
  return {
    text,
    words: countWords(text),
    characters: text.length,
    kind: meta.kind,
    meta,
    ats: runAtsChecks(text, meta, now),
    bullets: lintBullets(text),
  };
}
