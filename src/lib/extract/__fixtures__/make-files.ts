/**
 * Test-only builders for real PDF and DOCX files, so the extractors are
 * exercised against genuine pdf.js / mammoth parsing rather than mocks.
 */
import { jsPDF } from "jspdf";
import { deflateRawSync } from "node:zlib";

type PdfLine = {
  text: string;
  x?: number;
  y: number;
  size?: number;
  /** RGB 0–255 */
  color?: [number, number, number];
};

export function makePdf(pages: PdfLine[][], options: { banner?: boolean } = {}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  pages.forEach((lines, i) => {
    if (i > 0) doc.addPage();
    if (options.banner) {
      doc.setFillColor(20, 40, 80);
      doc.rect(0, 0, 612, 90, "F");
    }
    for (const line of lines) {
      doc.setFontSize(line.size ?? 11);
      const [r, g, b] = line.color ?? [0, 0, 0];
      doc.setTextColor(r, g, b);
      doc.text(line.text, line.x ?? 54, line.y);
    }
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Lay out a plain single-column resume, one line per entry, starting near the top. */
export function singleColumnPdf(text: string): Uint8Array {
  const lines = text.split("\n");
  const pages: PdfLine[][] = [[]];
  let y = 60;
  for (const line of lines) {
    if (y > 740) {
      pages.push([]);
      y = 60;
    }
    if (line.trim()) pages[pages.length - 1].push({ text: line, y, size: 10 });
    y += 14;
  }
  return makePdf(pages);
}

/* ---------------------------------------------------------------------------
   ZIP / DOCX
   ------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipInput = { name: string; data: string | Uint8Array; store?: boolean; declaredSize?: number };

/** Minimal ZIP writer. `declaredSize` lets a test lie in the central directory. */
export function makeZip(files: ZipInput[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const body = f.store ? raw : new Uint8Array(deflateRawSync(raw));
    const name = enc.encode(f.name);
    const crc = crc32(raw);
    const size = f.declaredSize ?? raw.length;

    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, f.store ? 0 : 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, f.store ? 0 : 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type DocxBlock =
  | { p: string; rPr?: string; style?: string }
  | { bullet: string }
  | { table: string[][] }
  | { textBox: string };

export function paragraphXml(block: DocxBlock): string {
  if ("p" in block) {
    const pPr = block.style ? `<w:pPr><w:pStyle w:val="${block.style}"/></w:pPr>` : "";
    const rPr = block.rPr ? `<w:rPr>${block.rPr}</w:rPr>` : "";
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(block.p)}</w:t></w:r></w:p>`;
  }
  if ("bullet" in block) {
    return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(block.bullet)}</w:t></w:r></w:p>`;
  }
  if ("table" in block) {
    const rows = block.table
      .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
      .join("");
    return `<w:tbl><w:tblPr/>${rows}</w:tbl>`;
  }
  return `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>${escapeXml(block.textBox)}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
}

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

export function makeDocx(
  blocks: DocxBlock[],
  options: { header?: string; extraEntries?: ZipInput[]; omitDocument?: boolean; sectPr?: string } = {},
): Uint8Array {
  const body = blocks.map(paragraphXml).join("") + (options.sectPr ?? "");
  const files: ZipInput[] = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${
        options.header
          ? '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
          : ""
      }</Relationships>`,
    },
    { name: "word/numbering.xml", data: NUMBERING },
  ];
  if (!options.omitDocument) {
    files.push({
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`,
    });
  }
  if (options.header) {
    files.push({
      name: "word/header1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}><w:p><w:r><w:t>${escapeXml(options.header)}</w:t></w:r></w:p></w:hdr>`,
    });
  }
  files.push(...(options.extraEntries ?? []));
  return makeZip(files);
}

/** Turn a plain-text resume into DOCX blocks: "- " lines become real Word list items. */
export function blocksFromText(text: string): DocxBlock[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => (l.startsWith("- ") ? { bullet: l.slice(2) } : { p: l }));
}
