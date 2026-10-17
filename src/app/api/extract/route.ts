import { DocxError, PdfTimeoutError, buildExtractResponse, extractResumeFile } from "@/lib/extract/extract";
import { checkFileContents } from "@/lib/extract/file-type";
import { countWords } from "@/lib/extract/normalize";
import type { ExtractMeta, ExtractResponse } from "@/lib/extract/types";
import { MAX_FILE_BYTES, MIN_RESUME_CHARS, formatBytes } from "@/lib/limits";
import { NextResponse } from "next/server";

// pdf and docx parsing both need Node APIs, so this route cannot run on edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The original success shape. It is still a subset of the response, so
 * existing callers keep working; new callers should use ExtractResponse.
 */
export type ExtractSuccess = Pick<ExtractResponse, "text" | "words" | "characters" | "kind">;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/** Room for the multipart boundary and headers around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch {
    // Last line of defence: always answer with JSON, never an HTML error page.
    return fail("Something went wrong reading that file. Try again.", 500);
  }
}

async function handle(request: Request) {
  // Refuse an oversized body before buffering it into memory as form data.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return fail(`That file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit.`, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Could not read the upload. Try again.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("No file was included in the request.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(`That file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit.`, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkFileContents(bytes, bytes.byteLength);
  if (!check.ok) {
    return fail(check.reason, 415);
  }

  let text: string;
  let meta: ExtractMeta;
  try {
    ({ text, meta } = await extractResumeFile(bytes, check.kind));
  } catch (error) {
    // The underlying error can echo document content, so it is deliberately
    // not logged or returned; only our own error classes choose the message.
    if (error instanceof PdfTimeoutError) {
      return fail("That PDF took too long to read. Try re-exporting it, or upload a DOCX.", 422);
    }
    if (error instanceof DocxError) {
      return fail(
        "That file is not a readable Word document, or it is too large once unpacked. Re-save it from your word processor and try again.",
        422,
      );
    }
    return fail(
      check.kind === "pdf"
        ? "That PDF could not be read. It may be encrypted or password-protected."
        : "That DOCX could not be read. Try re-saving it from your word processor.",
      422,
    );
  }

  const words = countWords(text);
  if (text.length < MIN_RESUME_CHARS || words < 40) {
    return fail(
      check.kind === "pdf"
        ? "Almost no text came out of that file. If it is a scan or an image-only PDF, export a text-based version and try again."
        : "Almost no text came out of that file. If the resume is laid out in text boxes or images, paste it into a plain document and try again.",
      422,
    );
  }

  const body: ExtractResponse = buildExtractResponse(text, { ...meta, kind: check.kind });

  // Nothing here is cacheable and none of it should linger in an intermediary.
  return NextResponse.json(body, { headers: NO_STORE });
}
