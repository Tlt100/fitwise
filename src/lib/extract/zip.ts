/**
 * Minimal ZIP central-directory reader. DOCX is a ZIP container, and handing
 * an untrusted ZIP straight to a parser invites decompression bombs and
 * malformed archives. This reads the directory itself, enforces limits, and
 * can inflate single entries with a hard output cap.
 */
import { inflateRawSync } from "node:zlib";

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export class ZipError extends Error {}

export const ZIP_LIMITS = {
  /** Total declared uncompressed size across all entries. */
  maxTotalUncompressed: 50 * 1024 * 1024,
  maxEntries: 2_000,
  /** Compression ratio above which an entry is treated as a bomb (only checked for entries > 1 MB). */
  maxRatio: 200,
};

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  // The end-of-central-directory record is 22 bytes plus an optional comment of up to 64 KB.
  const minStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minStart; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("No ZIP end-of-central-directory record.");

  const entryCount = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported.");
  }
  if (entryCount > ZIP_LIMITS.maxEntries) throw new ZipError("Too many entries in archive.");
  if (cdOffset + cdSize > bytes.length) throw new ZipError("Central directory is out of bounds.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  let total = 0;
  const decoder = new TextDecoder();
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CDH_SIG) {
      throw new ZipError("Corrupt central directory.");
    }
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > bytes.length) throw new ZipError("Corrupt central directory.");
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      throw new ZipError("ZIP64 entries are not supported.");
    }
    total += uncompressedSize;
    if (total > ZIP_LIMITS.maxTotalUncompressed) throw new ZipError("Archive expands beyond the size limit.");
    if (uncompressedSize > 1024 * 1024 && uncompressedSize / Math.max(1, compressedSize) > ZIP_LIMITS.maxRatio) {
      throw new ZipError("Suspicious compression ratio.");
    }
    if (localHeaderOffset + 30 > bytes.length) throw new ZipError("Entry is out of bounds.");

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry, refusing to produce more than its declared size. */
export function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const dv = view(bytes);
  const o = entry.localHeaderOffset;
  if (dv.getUint32(o, true) !== LFH_SIG) throw new ZipError("Corrupt local header.");
  const nameLen = dv.getUint16(o + 26, true);
  const extraLen = dv.getUint16(o + 28, true);
  const start = o + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError("Entry data is out of bounds.");
  const data = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw new ZipError("Stored entry size mismatch.");
    return data;
  }
  if (entry.method === 8) {
    try {
      // maxOutputLength makes zlib throw instead of expanding past the declared size,
      // so a lying central directory cannot smuggle a bomb past the total cap.
      return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) }));
    } catch {
      throw new ZipError("Entry failed to decompress within its declared size.");
    }
  }
  throw new ZipError(`Unsupported compression method ${entry.method}.`);
}

/**
 * Verify every entry actually decompresses within its declared size. Bounded
 * by ZIP_LIMITS.maxTotalUncompressed, so the work is capped too.
 */
export function verifyAllEntries(bytes: Uint8Array, entries: ZipEntry[]): void {
  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    readEntry(bytes, e);
  }
}
