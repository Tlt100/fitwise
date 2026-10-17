import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FallbackStore,
  MemoryStore,
  UpstashStore,
  clientKey,
  consume,
  createStoreFromEnv,
  getClientIp,
  rateLimit,
  resetRateLimits,
  type RateLimitStore,
} from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit and then refuses", () => {
    const now = 1_000_000;
    expect(rateLimit("a", 3, now).allowed).toBe(true);
    expect(rateLimit("a", 3, now).allowed).toBe(true);
    expect(rateLimit("a", 3, now).allowed).toBe(true);
    expect(rateLimit("a", 3, now).allowed).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    const now = 1_000_000;
    expect(rateLimit("a", 3, now).remaining).toBe(2);
    expect(rateLimit("a", 3, now).remaining).toBe(1);
    expect(rateLimit("a", 3, now).remaining).toBe(0);
  });

  it("keys are independent", () => {
    const now = 1_000_000;
    rateLimit("a", 1, now);
    expect(rateLimit("a", 1, now).allowed).toBe(false);
    expect(rateLimit("b", 1, now).allowed).toBe(true);
  });

  it("opens a fresh window once the old one expires", () => {
    const now = 1_000_000;
    rateLimit("a", 1, now);
    expect(rateLimit("a", 1, now + 59_000).allowed).toBe(false);
    expect(rateLimit("a", 1, now + 60_001).allowed).toBe(true);
  });

  it("reports seconds until reset when refusing", () => {
    const now = 1_000_000;
    rateLimit("a", 1, now);
    expect(rateLimit("a", 1, now + 30_000).retryAfter).toBe(30);
  });

  it("never reports a retryAfter of zero while blocked", () => {
    const now = 1_000_000;
    rateLimit("a", 1, now);
    expect(rateLimit("a", 1, now + 59_999).retryAfter).toBe(1);
  });
});

describe("clientKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("https://example.test/api/analyze", { headers });

  it("uses the left-most forwarded address", () => {
    const key = clientKey(
      withHeaders({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }),
      "analyze",
    );
    expect(key).toBe("analyze:203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(withHeaders({ "x-real-ip": "198.51.100.7" }), "chat")).toBe(
      "chat:198.51.100.7",
    );
  });

  it("scopes routes separately", () => {
    const headers = { "x-forwarded-for": "203.0.113.5" };
    expect(clientKey(withHeaders(headers), "analyze")).not.toBe(
      clientKey(withHeaders(headers), "chat"),
    );
  });

  it("groups callers with no address information", () => {
    expect(clientKey(withHeaders({}), "analyze")).toBe("analyze:unknown");
  });
});

describe("getClientIp", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("prefers Vercel's own forwarded header over anything the client sent", () => {
    expect(
      getClientIp(
        headers({
          "x-vercel-forwarded-for": "203.0.113.9",
          "x-real-ip": "198.51.100.1",
          "x-forwarded-for": "10.0.0.1, 203.0.113.9",
        }),
      ),
    ).toBe("203.0.113.9");
  });

  it("then x-real-ip, then the first x-forwarded-for hop", () => {
    expect(getClientIp(headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "198.51.100.1",
    );
    expect(getClientIp(headers({ "x-forwarded-for": " 1.1.1.1 , 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("ignores empty values", () => {
    expect(getClientIp(headers({ "x-vercel-forwarded-for": " ", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "1.1.1.1",
    );
    expect(getClientIp(headers({}))).toBe("unknown");
  });
});

describe("MemoryStore", () => {
  it("counts within a clock-aligned window and resets at its end", async () => {
    const store = new MemoryStore();
    const start = 120_000; // a window boundary for 60 s windows
    expect(await store.increment("k", 60_000, start)).toBe(1);
    expect(await store.increment("k", 60_000, start + 59_999)).toBe(2);
    expect(await store.increment("k", 60_000, start + 60_000)).toBe(1);
  });

  it("keeps keys and window sizes apart", async () => {
    const store = new MemoryStore();
    await store.increment("a", 60_000, 0);
    expect(await store.increment("b", 60_000, 0)).toBe(1);
    expect(await store.increment("a", 1_000, 0)).toBe(1);
  });
});

describe("consume", () => {
  const rules = [
    { name: "min", limit: 2, windowMs: 60_000 },
    { name: "day", limit: 3, windowMs: 86_400_000 },
  ];

  it("allows up to the tightest limit, then refuses with the minute wait", async () => {
    const store = new MemoryStore();
    const now = 86_400_000; // midnight, start of both windows
    expect((await consume(store, "ip", rules, now)).allowed).toBe(true);
    const second = await consume(store, "ip", rules, now);
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    const third = await consume(store, "ip", rules, now + 30_000);
    expect(third).toMatchObject({ allowed: false, rule: "min", retryAfter: 30 });
  });

  it("reports the daily wait once the daily cap is spent", async () => {
    const store = new MemoryStore();
    const day = 86_400_000;
    await consume(store, "ip", rules, day);
    await consume(store, "ip", rules, day);
    await consume(store, "ip", rules, day + 61_000);
    const refused = await consume(store, "ip", rules, day + 61_000);
    expect(refused.allowed).toBe(false);
    expect(refused.rule).toBe("day");
    expect(refused.retryAfter).toBe(Math.ceil((day - 61_000) / 1000));
  });
});

function upstashFetch(results: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(results), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("UpstashStore", () => {
  it("sends INCR and PEXPIRE in one pipeline call and returns the count", async () => {
    const fetchMock = upstashFetch([{ result: 4 }, { result: 1 }]);
    const store = new UpstashStore("https://example.upstash.io/", "secret", fetchMock);

    expect(await store.increment("chat:1.2.3.4:min", 60_000, 90_000)).toBe(4);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const commands = JSON.parse(String(init.body)) as string[][];
    expect(commands[0][0]).toBe("INCR");
    expect(commands[0][1]).toBe("fitwise:rl:chat:1.2.3.4:min:60000:1");
    // 30 s left in the window plus a second of grace.
    expect(commands[1]).toEqual(["PEXPIRE", commands[0][1], "31000"]);
  });

  it("throws on an HTTP error or a command error", async () => {
    await expect(
      new UpstashStore("https://x", "t", upstashFetch({ error: "nope" }, 401)).increment("k", 1000, 0),
    ).rejects.toThrow(/401/);
    await expect(
      new UpstashStore("https://x", "t", upstashFetch([{ error: "WRONGTYPE" }])).increment("k", 1000, 0),
    ).rejects.toThrow(/WRONGTYPE/);
  });
});

describe("FallbackStore and createStoreFromEnv", () => {
  it("falls back to the secondary store when the primary fails", async () => {
    const failing: RateLimitStore = {
      name: "broken",
      increment: async () => {
        throw new Error("down");
      },
    };
    const onError = vi.fn();
    const store = new FallbackStore(failing, new MemoryStore(), onError);
    expect(await store.increment("k", 60_000, 0)).toBe(1);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("uses memory unless both Upstash variables are set", async () => {
    expect(createStoreFromEnv({}).name).toBe("memory");
    expect(createStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://x" }).name).toBe("memory");
    const fetchMock = upstashFetch([{ result: 7 }, { result: 1 }]);
    const store = createStoreFromEnv(
      { UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" },
      fetchMock,
    );
    expect(store.name).toBe("upstash+memory");
    expect(await store.increment("k", 60_000, 0)).toBe(7);
  });
});
