/**
 * Fixed-window rate limiting behind a pluggable store.
 *
 * Two layers live here:
 *
 * - `rateLimit()` is the original synchronous, in-memory limiter. Routes may
 *   still call it; its signature is kept stable.
 * - `RateLimitStore` + `consume()` are what the API guard in `src/proxy.ts`
 *   uses. The default store is in-memory (one counter per serverless
 *   instance, so it throttles a runaway client but is not a distributed
 *   guarantee). When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
 *   are set, `getDefaultStore()` returns a store backed by Upstash Redis over
 *   its REST API (plain fetch, no SDK), shared by every instance.
 *
 * Windows are aligned to the clock (`floor(now / windowMs)`), so a store only
 * needs an atomic increment plus an expiry for cleanup. See docs/security.md.
 */

// ---------------------------------------------------------------------------
// Legacy synchronous limiter (kept for route-level callers)
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** Stops the map growing without bound on a long-lived instance. */
function sweep(map: Map<string, Bucket>, now: number) {
  if (map.size < 500) return;
  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; used for the Retry-After header. */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  limit: number,
  now: number = Date.now(),
): RateLimitResult {
  sweep(buckets, now);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfter };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfter };
}

/** Test seam. Clears the legacy limiter and the default in-memory store. */
export function resetRateLimits() {
  buckets.clear();
  memoryStore.clear();
  defaultStore = undefined;
}

// ---------------------------------------------------------------------------
// Client identity
// ---------------------------------------------------------------------------

type HeaderSource = Pick<Headers, "get">;

/**
 * Best-effort client IP. Order matters:
 *
 * 1. `x-vercel-forwarded-for` — set by Vercel's edge; a client cannot spoof it.
 * 2. `x-real-ip` — also set by Vercel (and most reverse proxies).
 * 3. The first hop of `x-forwarded-for`.
 *
 * Unknown callers share one bucket, which is deliberately conservative.
 */
export function getClientIp(headers: HeaderSource): string {
  const firstHop = (value: string | null) => value?.split(",")[0]?.trim() || "";
  return (
    firstHop(headers.get("x-vercel-forwarded-for")) ||
    headers.get("x-real-ip")?.trim() ||
    firstHop(headers.get("x-forwarded-for")) ||
    "unknown"
  );
}

export function clientKey(request: Request, scope: string): string {
  return `${scope}:${getClientIp(request.headers)}`;
}

// ---------------------------------------------------------------------------
// Pluggable store
// ---------------------------------------------------------------------------

export interface RateLimitStore {
  readonly name: string;
  /**
   * Atomically increment the counter for `key` in the window containing
   * `now` and return the new count. Implementations must keep the counter
   * at least until the end of that window.
   */
  increment(key: string, windowMs: number, now: number): Promise<number>;
}

function windowKey(key: string, windowMs: number, now: number) {
  return `${key}:${windowMs}:${Math.floor(now / windowMs)}`;
}

function windowEnd(windowMs: number, now: number) {
  return (Math.floor(now / windowMs) + 1) * windowMs;
}

export class MemoryStore implements RateLimitStore {
  readonly name = "memory";
  private counters = new Map<string, Bucket>();

  async increment(key: string, windowMs: number, now: number): Promise<number> {
    sweep(this.counters, now);
    const id = windowKey(key, windowMs, now);
    const existing = this.counters.get(id);
    if (!existing || existing.resetAt <= now) {
      this.counters.set(id, { count: 1, resetAt: windowEnd(windowMs, now) });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  clear() {
    this.counters.clear();
  }
}

/**
 * Upstash Redis over the REST pipeline API: `INCR` then `PEXPIRE` in one round
 * trip. Because the key embeds the window index, re-setting the expiry on
 * every hit is harmless: it always lands at the window's end plus a second.
 */
export class UpstashStore implements RateLimitStore {
  readonly name = "upstash";

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly prefix = "fitwise:rl:",
    private readonly timeoutMs = 1_500,
  ) {}

  async increment(key: string, windowMs: number, now: number): Promise<number> {
    const id = this.prefix + windowKey(key, windowMs, now);
    const ttl = Math.max(1, windowEnd(windowMs, now) - now) + 1_000;
    const response = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", id],
        ["PEXPIRE", id, String(ttl)],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Upstash responded ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const first = Array.isArray(payload)
      ? (payload[0] as { result?: unknown; error?: string } | undefined)
      : undefined;
    if (!first || first.error || typeof first.result !== "number") {
      throw new Error(`Upstash INCR failed: ${first?.error ?? "unexpected response"}`);
    }
    return first.result;
  }
}

/**
 * Tries the primary store and falls back to another (normally in-memory) if
 * it errors, so a Redis outage degrades to per-instance limits instead of
 * either blocking every request or removing limits altogether.
 */
export class FallbackStore implements RateLimitStore {
  readonly name: string;
  constructor(
    private readonly primary: RateLimitStore,
    private readonly fallback: RateLimitStore,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  async increment(key: string, windowMs: number, now: number): Promise<number> {
    try {
      return await this.primary.increment(key, windowMs, now);
    } catch (error) {
      this.onError(error);
      return this.fallback.increment(key, windowMs, now);
    }
  }
}

const memoryStore = new MemoryStore();
let defaultStore: RateLimitStore | undefined;

/** Upstash when both env vars are set, otherwise this instance's memory. */
export function createStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): RateLimitStore {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    return new FallbackStore(new UpstashStore(url, token, fetchImpl), memoryStore, (error) =>
      console.warn("[rate-limit] Upstash unavailable, using in-memory limits:", error),
    );
  }
  return memoryStore;
}

export function getDefaultStore(): RateLimitStore {
  defaultStore ??= createStoreFromEnv();
  return defaultStore;
}

// ---------------------------------------------------------------------------
// Multi-window check
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  /** Short label used in the key, e.g. "min" or "day". */
  name: string;
  limit: number;
  windowMs: number;
}

export interface ConsumeResult extends RateLimitResult {
  /** The rule that refused the request, when one did. */
  rule?: string;
}

/**
 * Count one request against every rule (e.g. per minute and per day) and
 * refuse if any is over its limit. Every rule is incremented, so a burst the
 * minute rule refuses still counts toward the daily cap.
 */
export async function consume(
  store: RateLimitStore,
  key: string,
  rules: readonly RateLimitRule[],
  now: number = Date.now(),
): Promise<ConsumeResult> {
  const counts = await Promise.all(
    rules.map((rule) => store.increment(`${key}:${rule.name}`, rule.windowMs, now)),
  );

  let remaining = Infinity;
  let refused: { rule: RateLimitRule; retryAfter: number } | undefined;

  rules.forEach((rule, index) => {
    const count = counts[index];
    remaining = Math.min(remaining, Math.max(0, rule.limit - count));
    if (count > rule.limit) {
      const retryAfter = Math.max(1, Math.ceil((windowEnd(rule.windowMs, now) - now) / 1000));
      // Report the longest wait: the minute window reopening does not help
      // someone who is out of daily budget.
      if (!refused || retryAfter > refused.retryAfter) refused = { rule, retryAfter };
    }
  });

  if (refused) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: refused.retryAfter,
      rule: refused.rule.name,
    };
  }
  return { allowed: true, remaining: Number.isFinite(remaining) ? remaining : 0, retryAfter: 0 };
}
