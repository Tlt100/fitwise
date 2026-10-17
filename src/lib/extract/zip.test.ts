import { describe, expect, it } from "vitest";
import { makeZip } from "./__fixtures__/make-files";
import { ZIP_LIMITS, ZipError, readCentralDirectory, readEntry, verifyAllEntries } from "./zip";

describe("readCentralDirectory", () => {
  it("lists entries with sizes", () => {
    const zip = makeZip([
      { name: "a.txt", data: "hello" },
      { name: "b.txt", data: "world", store: true },
    ]);
    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => [e.name, e.method, e.uncompressedSize])).toEqual([
      ["a.txt", 8, 5],
      ["b.txt", 0, 5],
    ]);
    expect(new TextDecoder().decode(readEntry(zip, entries[0]))).toBe("hello");
    expect(new TextDecoder().decode(readEntry(zip, entries[1]))).toBe("world");
  });

  it("rejects bytes that are not a ZIP", () => {
    expect(() => readCentralDirectory(new TextEncoder().encode("PK\x03\x04 not really a zip"))).toThrow(ZipError);
  });

  it("rejects archives whose declared total exceeds the cap", () => {
    // Each entry stays at the 1 MB ratio-check threshold; together they exceed the total cap.
    const count = Math.ceil(ZIP_LIMITS.maxTotalUncompressed / (1024 * 1024)) + 1;
    const zip = makeZip(
      Array.from({ length: count }, (_, i) => ({ name: `part${i}.xml`, data: "x", declaredSize: 1024 * 1024 })),
    );
    expect(() => readCentralDirectory(zip)).toThrow(/size limit/);
  });

  it("rejects an extreme compression ratio (zip bomb)", () => {
    const zip = makeZip([{ name: "bomb", data: new Uint8Array(5 * 1024 * 1024) }]);
    expect(() => readCentralDirectory(zip)).toThrow(/compression ratio/);
  });

  it("refuses to inflate beyond the declared size (lying directory)", () => {
    const zip = makeZip([{ name: "liar.xml", data: "a".repeat(10_000), declaredSize: 100 }]);
    const entries = readCentralDirectory(zip);
    expect(() => verifyAllEntries(zip, entries)).toThrow(ZipError);
  });
});
