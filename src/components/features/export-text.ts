/**
 * Client-side DOCX/PDF export for generated prose (cover letters, rewrites).
 *
 * The shared helpers in lib/export name every file "<resume> (revised)", which
 * is right for a revised resume and wrong for a cover letter, so this wraps the
 * same libraries with a caller-chosen filename. Libraries load lazily.
 */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** "Acme Corp" -> "Cover letter - Acme Corp". Strips characters filesystems reject. */
export function safeFilename(base: string, extension: string): string {
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${(cleaned || "document").slice(0, 100)}.${extension}`;
}

export async function exportTextDocx(text: string, filename: string) {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const paragraphs = text.split("\n").map(
    (line) =>
      new Paragraph({
        spacing: { after: line.trim() ? 120 : 200 },
        children: [new TextRun({ text: line.trimEnd(), font: "Calibri", size: 22 })],
      }),
  );
  const document = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  triggerDownload(await Packer.toBlob(document), safeFilename(filename, "docx"));
}

export async function exportTextPdf(text: string, filename: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 64;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const lineHeight = 16;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);

  let y = margin;
  for (const line of text.split("\n")) {
    const wrapped: string[] = line.trim() ? pdf.splitTextToSize(line.trimEnd(), width) : [""];
    for (const piece of wrapped) {
      if (y + lineHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(piece, margin, y);
      y += lineHeight;
    }
  }
  triggerDownload(pdf.output("blob"), safeFilename(filename, "pdf"));
}

/** Download arbitrary text (used for the history JSON export). */
export function downloadText(text: string, filename: string, type = "application/json") {
  triggerDownload(new Blob([text], { type }), filename);
}
