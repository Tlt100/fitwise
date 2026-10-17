import { describe, expect, it } from "vitest";
import { revisedFilename } from "./export-document";

describe("revisedFilename", () => {
  it("marks the export as revised so it cannot be mistaken for the original", () => {
    expect(revisedFilename("Jordan Ellis.pdf", "docx")).toBe(
      "Jordan Ellis (revised).docx",
    );
  });

  it("strips the source extension regardless of case", () => {
    expect(revisedFilename("resume.DOCX", "pdf")).toBe("resume (revised).pdf");
  });

  it("keeps dots that are part of the name", () => {
    expect(revisedFilename("j.ellis.resume.pdf", "pdf")).toBe(
      "j.ellis.resume (revised).pdf",
    );
  });

  it("falls back to a name when the file was only an extension", () => {
    expect(revisedFilename(".pdf", "docx")).toBe("resume (revised).docx");
  });

  it("leaves an unexpected extension alone rather than mangling the name", () => {
    expect(revisedFilename("resume.txt", "docx")).toBe("resume.txt (revised).docx");
  });
});
