import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, resetRateLimits } from "@/lib/rate-limit";
import { messageForFailure } from "./read-error";
import {
  DAILY_LIMIT_MESSAGE,
  MAX_JSON_BODY_BYTES,
  RATE_LIMITED_MESSAGE,
  checkOrigin,
  guardApiRequest,
  policyFor,
} from "./api-guard";

beforeEach(() => resetRateLimits());

const SITE = "https://fitwise.example";

function post(path: string, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`${SITE}${path}`, {
    method,
    headers: { host: "fitwise.example", ...headers },
  });
}

const sameOrigin = { "sec-fetch-site": "same-origin", "x-vercel-forwarded-for": "203.0.113.5" };

describe("checkOrigin", () => {
  const decide = (headers: Record<string, string>, isDev = false, method = "POST") =>
    checkOrigin({ method, headers: new Headers(headers), url: `${SITE}/api/chat` }, { isDev });

  it("lets safe methods through untouched", () => {
    expect(decide({ "sec-fetch-site": "cross-site" }, false, "GET")).toEqual({ ok: true });
  });

  it("accepts same-origin and user-initiated fetches", () => {
    expect(decide({ "sec-fetch-site": "same-origin" })).toEqual({ ok: true });
    expect(decide({ "sec-fetch-site": "none" })).toEqual({ ok: true });
  });

  it("refuses cross-site and same-site fetches, even with a matching Origin", () => {
    expect(decide({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })).toEqual({
      ok: false,
      reason: "cross-site",
    });
    expect(decide({ "sec-fetch-site": "same-site", origin: SITE })).toMatchObject({ ok: false });
  });

  it("falls back to comparing Origin with the host", () => {
    expect(decide({ origin: SITE, host: "fitwise.example" })).toEqual({ ok: true });
    expect(decide({ origin: SITE, "x-forwarded-host": "fitwise.example" })).toEqual({ ok: true });
    expect(decide({ origin: "https://evil.example", host: "fitwise.example" })).toEqual({
      ok: false,
      reason: "origin-mismatch",
    });
    expect(decide({ origin: "null" })).toMatchObject({ ok: false, reason: "origin-mismatch" });
  });

  it("refuses requests with no browser origin signal in production only", () => {
    expect(decide({})).toEqual({ ok: false, reason: "missing-origin" });
    expect(decide({}, true)).toEqual({ ok: true });
  });

  it("allows loopback origins in development, not in production", () => {
    const local = { "sec-fetch-site": "cross-site", origin: "http://127.0.0.1:3000" };
    expect(decide(local, true)).toEqual({ ok: true });
    expect(decide(local, false)).toMatchObject({ ok: false });
    expect(decide({ origin: "http://localhost:3000" }, true)).toEqual({ ok: true });
  });
});

describe("policyFor", () => {
  it("gives the AI routes a minute and a daily budget", () => {
    for (const path of ["/api/analyze", "/api/chat", "/api/cover-letter", "/api/rewrite/"]) {
      const policy = policyFor(path, {});
      expect(policy.rules).toEqual([
        { name: "min", limit: 10, windowMs: 60_000 },
        { name: "day", limit: 60, windowMs: 86_400_000 },
      ]);
      expect(policy.maxBodyBytes).toBe(MAX_JSON_BODY_BYTES);
    }
    expect(policyFor("/api/chat", {}).scope).toBe("chat");
  });

  it("reads overrides from the environment", () => {
    const policy = policyFor("/api/analyze", {
      AI_RATE_LIMIT_PER_MINUTE: "3",
      AI_RATE_LIMIT_PER_DAY: "20",
    });
    expect(policy.rules.map((rule) => rule.limit)).toEqual([3, 20]);
    expect(policyFor("/api/analyze", { AI_RATE_LIMIT_PER_MINUTE: "junk" }).rules[0].limit).toBe(10);
  });

  it("allows uploads up to the file limit plus multipart overhead", () => {
    const policy = policyFor("/api/extract", {});
    expect(policy.rules[0].limit).toBe(20);
    expect(policy.maxBodyBytes).toBe(4 * 1024 * 1024 + 64 * 1024);
  });

  it("does not let a look-alike path borrow another route's policy", () => {
    expect(policyFor("/api/chatty", {}).scope).toBe("api");
  });
});

describe("guardApiRequest", () => {
  const options = (store = new MemoryStore()) => ({ isDev: false, env: {}, store, now: 0 });

  it("passes a well-formed same-origin request", async () => {
    expect(await guardApiRequest(post("/api/chat", sameOrigin), options())).toBeNull();
  });

  it("answers a cross-site POST with JSON 403", async () => {
    const response = await guardApiRequest(
      post("/api/chat", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
      options(),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "forbidden-origin" });
  });

  it("refuses an oversized declared body before reading it", async () => {
    const tooBig = String(MAX_JSON_BODY_BYTES + 1);
    const response = await guardApiRequest(
      post("/api/analyze", { ...sameOrigin, "content-length": tooBig }),
      options(),
    );
    expect(response?.status).toBe(413);
    expect(await response?.json()).toMatchObject({ code: "payload-too-large" });

    const upload = await guardApiRequest(
      post("/api/extract", { ...sameOrigin, "content-length": String(3 * 1024 * 1024) }),
      options(),
    );
    expect(upload).toBeNull();
  });

  it("returns a 429 the client already understands, with Retry-After", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 10; index += 1) {
      expect(await guardApiRequest(post("/api/chat", sameOrigin), options(store))).toBeNull();
    }
    const response = await guardApiRequest(post("/api/chat", sameOrigin), {
      ...options(store),
      now: 15_000,
    });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("45");
    expect(response?.headers.get("cache-control")).toContain("no-store");
    const body = await response?.json();
    expect(body).toEqual({ error: RATE_LIMITED_MESSAGE, code: "rate-limited" });
    // The UI shows the body's error string as-is.
    expect(messageForFailure(429, body, "fallback")).toBe(RATE_LIMITED_MESSAGE);
  });

  it("budgets routes and clients separately", async () => {
    const store = new MemoryStore();
    const env = { AI_RATE_LIMIT_PER_MINUTE: "1" };
    const run = (path: string, ip: string) =>
      guardApiRequest(post(path, { ...sameOrigin, "x-vercel-forwarded-for": ip }), {
        ...options(store),
        env,
      });
    expect(await run("/api/chat", "1.1.1.1")).toBeNull();
    expect((await run("/api/chat", "1.1.1.1"))?.status).toBe(429);
    expect(await run("/api/chat", "2.2.2.2")).toBeNull();
    expect(await run("/api/analyze", "1.1.1.1")).toBeNull();
  });

  it("uses the daily message once the daily cap is reached", async () => {
    const store = new MemoryStore();
    const env = { AI_RATE_LIMIT_PER_MINUTE: "100", AI_RATE_LIMIT_PER_DAY: "2" };
    const run = () => guardApiRequest(post("/api/analyze", sameOrigin), { ...options(store), env });
    await run();
    await run();
    const response = await run();
    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({ error: DAILY_LIMIT_MESSAGE, code: "rate-limited" });
  });

  it("lets requests through if the limiter itself fails", async () => {
    const broken = {
      name: "broken",
      increment: async () => {
        throw new Error("down");
      },
    };
    expect(
      await guardApiRequest(post("/api/chat", sameOrigin), { ...options(), store: broken }),
    ).toBeNull();
  });
});
