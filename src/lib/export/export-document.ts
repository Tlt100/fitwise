import { toParagraphs } from "@/lib/export/build-draft";

/**
 * Client-side export. The revised text never goes back to a server to become a
 * file — the document is assembled in the browser and handed straight to the
 * download. Heavy libraries are imported lazily so they stay out of the initial
 * page bundle.
 */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in Firefox and Safari,
  // which start reading the blob only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** `resume.pdf` -> `resume (revised).docx`, so the original is never shadowed. */
export function revisedFilename(originalName: string, extension: string): string {
  const base = originalName.replace(/\.(pdf|docx)$/i, "") || "resume";
  return `${base} (revised).${extension}`;
}

export async function exportDocx(text: string, originalName: string) {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");

  const paragraphs = toParagraphs(text).map(
    (line) =>
      new Paragraph({
        spacing: { after: line ? 80 : 160 },
        children: [new TextRun({ text: line, font: "Calibri", size: 22 })],
      }),
  );

  const document = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const blob = await Packer.toBlob(document);
  triggerDownload(blob, revisedFilename(originalName, "docx"));
}

export async function exportPdf(text: string, originalName: string) {
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 56;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const lineHeight = 14;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10.5);

  let y = margin;
  for (const line of toParagraphs(text)) {
    // An empty source line is a paragraph break, not a wrapped line.
    const wrapped: string[] = line ? pdf.splitTextToSize(line, width) : [""];
    for (const piece of wrapped) {
      if (y + lineHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(piece, margin, y);
      y += lineHeight;
    }
  }

  triggerDownload(pdf.output("blob"), revisedFilename(originalName, "pdf"));
}
