import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, formatBytes } from "@/lib/limits";

export type ResumeFileKind = "pdf" | "docx";

export type FileCheck =
  | { ok: true; kind: ResumeFileKind }
  | { ok: false; reason: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — DOCX is a zip container

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Identify a file by its leading bytes rather than trusting the extension or
 * the browser-reported MIME type, both of which are attacker-controlled.
 */
export function sniffFileKind(bytes: Uint8Array): ResumeFileKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, ZIP_MAGIC)) return "docx";
  return null;
}

/** Cheap pre-flight in the browser, before we spend a round trip. */
export function checkFileMetadata(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; reason: string } {
  const lower = file.name.toLowerCase();
  const hasAccepted = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));

  if (!hasAccepted) {
    return {
      ok: false,
      reason: "That file type is not supported. Upload a PDF or a DOCX resume.",
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(
        MAX_FILE_BYTES,
      )} — try exporting a text-based PDF rather than a scan.`,
    };
  }
  return { ok: true };
}

/** Authoritative server-side check: size, then actual content signature. */
export function checkFileContents(bytes: Uint8Array, size: number): FileCheck {
  if (size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `File exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`,
    };
  }
  if (size === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  const kind = sniffFileKind(bytes);
  if (!kind) {
    return {
      ok: false,
      reason:
        "That does not look like a PDF or DOCX file. Re-export your resume and try again.",
    };
  }
  return { ok: true, kind };
}
