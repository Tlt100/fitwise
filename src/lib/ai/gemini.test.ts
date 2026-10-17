import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// gemini.ts is server-only; the guard package throws outside a server bundle.
vi.mock("server-only", () => ({}));

const { GeminiError, generate, mapHttpError, readCandidateText } = await import("./gemini");

function okBody(text: string) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
}

describe("mapHttpError", () => {
  it("treats an unknown model (404) as unavailable so the chain falls through", () => {
    expect(mapHttpError(404, "models/x is not found").code).toBe("unavailable");
  });

  it("separates an exhausted daily quota from a short-window rate limit", () => {
    expect(mapHttpError(429, "Quota exceeded PerDay").code).toBe("quota-exhausted");
    expect(mapHttpError(429, "slow down").code).toBe("rate-limited");
  });

  it("recognises a rejected key", () => {
    expect(mapHttpError(400, "API key not valid").code).toBe("invalid-key");
  });
});

describe("readCandidateText", () => {
  it("joins the parts of the first candidate", () => {
    expect(readCandidateText(okBody("hello"))).toBe("hello");
  });

  it("reports a non-JSON body as a bad response", () => {
    expect(() => readCandidateText("<html>")).toThrow(GeminiError);
  });

  it("reports a JSON null body as a bad response instead of crashing", () => {
    expect(() => readCandidateText("null")).toThrow(/could not read/);
  });

  it("reports a safety stop as blocked", () => {
    const body = JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] });
    try {
      readCandidateText(body);
      expect.unreachable();
    } catch (error) {
      expect((error as InstanceType<typeof GeminiError>).code).toBe("blocked");
    }
  });
});

describe("generate", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GEMINI_BASE_URL", "http://stub.test/models");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls through to the next model when one is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(okBody("from fallback"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generate({ system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    ).resolves.toBe("from fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a bad key on other models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generate({ system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    ).rejects.toMatchObject({ code: "invalid-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats timeoutMs as a budget for the whole chain", async () => {
    // Every attempt hangs until aborted.
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    await expect(
      generate({
        system: "s",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        timeoutMs: 1_200,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts when the caller's signal is already aborted", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (init.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
          else resolve(new Response(okBody("late"), { status: 200 }));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      generate({
        system: "s",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
