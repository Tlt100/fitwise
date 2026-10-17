import { describe, expect, it } from "vitest";
import { GOOD_RESUME, INJECTION_RESUME } from "@/lib/ats/__fixtures__/resumes";
import { blocksFromText, makeDocx, makeZip, singleColumnPdf } from "@/lib/extract/__fixtures__/make-files";
import type { ExtractResponse } from "@/lib/extract/types";
import { POST } from "./route";

function upload(bytes: Uint8Array, name: string): Request {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  return new Request("http://localhost/api/extract", { method: "POST", body: form });
}

describe("POST /api/extract", () => {
  it("returns the legacy fields plus meta, ats and bullets for a PDF", async () => {
    const res = await POST(upload(singleColumnPdf(GOOD_RESUME), "resume.pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as ExtractResponse;
    expect(body.kind).toBe("pdf");
    expect(body.text).toContain("Jordan Rivera");
    expect(body.words).toBeGreaterThan(200);
    expect(body.characters).toBe(body.text.length);
    expect(body.meta).toMatchObject({ kind: "pdf", pages: 1, pagesProcessed: 1 });
    expect(body.ats.risk).toBe("low");
    expect(body.ats.suspectedInjection).toBe(false);
    expect(body.bullets.total).toBe(10);
  }, 60_000);

  it("analyses a DOCX and reports injection text", async () => {
    const res = await POST(upload(makeDocx(blocksFromText(INJECTION_RESUME)), "resume.docx"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExtractResponse;
    expect(body.kind).toBe("docx");
    expect(body.meta.hasTables).toBe(false);
    expect(body.ats.suspectedInjection).toBe(true);
  }, 60_000);

  it("rejects a ZIP that is not a Word document with a JSON error", async () => {
    const res = await POST(upload(makeZip([{ name: "notes.txt", data: "hello" }]), "resume.docx"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/not a readable Word document/) });
  });

  it("rejects unknown file types", async () => {
    const res = await POST(upload(new TextEncoder().encode("just text"), "resume.pdf"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBeTruthy();
  });

  it("rejects a request without a file", async () => {
    const res = await POST(new Request("http://localhost/api/extract", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });
});
