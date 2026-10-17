import { describe, expect, it } from "vitest";
import { checkFileContents, checkFileMetadata, sniffFileKind } from "./file-type";
import { MAX_FILE_BYTES, formatBytes } from "@/lib/limits";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

describe("sniffFileKind", () => {
  it("identifies a PDF by its signature", () => {
    expect(sniffFileKind(pdf)).toBe("pdf");
  });

  it("identifies a DOCX by its zip signature", () => {
    expect(sniffFileKind(docx)).toBe("docx");
  });

  it("rejects content that only claims to be a document", () => {
    expect(sniffFileKind(new TextEncoder().encode("<?php echo 1; ?>"))).toBeNull();
  });

  it("does not read past the end of a short buffer", () => {
    expect(sniffFileKind(new Uint8Array([0x25]))).toBeNull();
  });
});

describe("checkFileMetadata", () => {
  it("accepts a normal resume", () => {
    expect(checkFileMetadata({ name: "resume.pdf", size: 120_000 })).toEqual({
      ok: true,
    });
  });

  it("is case-insensitive about the extension", () => {
    expect(checkFileMetadata({ name: "Resume.PDF", size: 100 }).ok).toBe(true);
  });

  it("rejects unsupported types", () => {
    const result = checkFileMetadata({ name: "resume.txt", size: 100 });
    expect(result.ok).toBe(false);
  });

  it("rejects empty files", () => {
    expect(checkFileMetadata({ name: "resume.pdf", size: 0 }).ok).toBe(false);
  });

  it("rejects files over the size limit", () => {
    const result = checkFileMetadata({ name: "resume.pdf", size: MAX_FILE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(`limit is ${formatBytes(MAX_FILE_BYTES)}`);
  });
});

describe("checkFileContents", () => {
  it("trusts bytes over a misleading name", () => {
    // A .pdf-named file whose bytes are a DOCX still extracts correctly.
    expect(checkFileContents(docx, docx.length)).toEqual({ ok: true, kind: "docx" });
  });

  it("rejects a renamed executable", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    expect(checkFileContents(exe, exe.length).ok).toBe(false);
  });

  it("says an empty upload is empty rather than the wrong type", () => {
    const result = checkFileContents(new Uint8Array(0), 0);
    expect(result).toEqual({ ok: false, reason: "That file is empty." });
  });

  it("rejects oversized payloads regardless of signature", () => {
    expect(checkFileContents(pdf, MAX_FILE_BYTES + 1).ok).toBe(false);
  });
});
