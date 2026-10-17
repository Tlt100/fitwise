/**
 * Central guard for every `/api/*` request, run from `src/proxy.ts` before a
 * route handler sees the request. Route handlers stay free to add their own
 * checks; nothing here depends on them.
 *
 * In order:
 * 1. Same-origin enforcement for state-changing methods, so another site (or a
 *    script pretending to be a browser on another site) cannot use this
 *    deployment as a free Gemini proxy.
 * 2. A declared-size precheck, so an oversized body is refused before any
 *    handler buffers it.
 * 3. Per-route, per-IP rate limits (per minute and per day).
 *
 * Failures answer with the same `{ error, code }` JSON the routes use, which
 * `messageForFailure()` in read-error.ts already turns into UI text.
 */
import { MAX_FILE_BYTES, formatBytes } from "@/lib/limits";
import {
  consume,
  getClientIp,
  getDefaultStore,
  type RateLimitRule,
  type RateLimitStore,
} from "@/lib/rate-limit";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

export type OriginDecision =
  | { ok: true }
  | { ok: false; reason: "cross-site" | "origin-mismatch" | "missing-origin" };

interface OriginInput {
  method: string;
  headers: Pick<Headers, "get">;
  /** The request URL; its host is one of the accepted hosts. */
  url: string;
}

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function hostOf(origin: string): { host: string; hostname: string } | null {
  if (!origin || origin === "null") return null;
  try {
    const url = new URL(origin);
    return { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/** The hosts this request was addressed to (direct, and via a proxy). */
function acceptedHosts(input: OriginInput): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const first = value?.split(",")[0]?.trim().toLowerCase();
    if (first) hosts.add(first);
  };
  add(input.headers.get("host"));
  add(input.headers.get("x-forwarded-host"));
  try {
    add(new URL(input.url).host);
  } catch {
    // A relative or malformed URL simply contributes nothing.
  }
  return hosts;
}

/**
 * Browsers send `Sec-Fetch-Site` on every fetch; it cannot be set by page
 * script, so it is the primary signal. `Origin` covers older browsers. A
 * request with neither is not from a browser on this site; it is refused in
 * production and allowed in development so local scripts keep working.
 */
export function checkOrigin(input: OriginInput, options: { isDev: boolean }): OriginDecision {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };

  const origin = input.headers.get("origin");
  const parsed = origin ? hostOf(origin) : null;
  const devLoopback = options.isDev && parsed !== null && isLoopback(parsed.hostname);

  const site = input.headers.get("sec-fetch-site")?.toLowerCase();
  if (site === "same-origin" || site === "none") return { ok: true };
  if (site) {
    // "same-site" or "cross-site". In development, localhost vs 127.0.0.1
    // counts as cross-site, so loopback origins are let through there.
    return devLoopback ? { ok: true } : { ok: false, reason: "cross-site" };
  }

  if (origin) {
    if (devLoopback) return { ok: true };
    if (parsed && acceptedHosts(input).has(parsed.host)) return { ok: true };
    return { ok: false, reason: "origin-mismatch" };
  }

  return options.isDev ? { ok: true } : { ok: false, reason: "missing-origin" };
}

// ---------------------------------------------------------------------------
// Per-route policy
// ---------------------------------------------------------------------------

export interface RoutePolicy {
  /** Rate-limit key scope. */
  scope: string;
  rules: RateLimitRule[];
  /** Largest accepted declared body, in bytes. */
  maxBodyBytes: number;
  /** Shown when the body is too large. */
  tooLargeMessage: string;
}

/** Routes that spend Gemini quota. Future AI routes belong in this list. */
export const AI_ROUTES = ["/api/analyze", "/api/chat", "/api/cover-letter", "/api/rewrite"];

/**
 * JSON bodies: the largest legitimate one is a chat turn carrying a 30k-char
 * resume, a 20k-char posting and the capped history. 256 KB leaves room for
 * multi-byte text and JSON escaping.
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/** Room for the multipart boundary and headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function matches(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function policyFor(pathname: string, env: Env = process.env): RoutePolicy {
  const path = pathname.replace(/\/+$/, "") || "/";

  const ai = AI_ROUTES.find((route) => matches(path, route));
  if (ai) {
    return {
      scope: ai.slice("/api/".length),
      rules: [
        { name: "min", limit: positiveInt(env.AI_RATE_LIMIT_PER_MINUTE, 10), windowMs: MINUTE },
        { name: "day", limit: positiveInt(env.AI_RATE_LIMIT_PER_DAY, 60), windowMs: DAY },
      ],
      maxBodyBytes: MAX_JSON_BODY_BYTES,
      tooLargeMessage: "That request is too large. Shorten the text and try again.",
    };
  }

  if (matches(path, "/api/extract")) {
    return {
      scope: "extract",
      rules: [
        { name: "min", limit: positiveInt(env.EXTRACT_RATE_LIMIT_PER_MINUTE, 20), windowMs: MINUTE },
        { name: "day", limit: 200, windowMs: DAY },
      ],
      maxBodyBytes: MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
      tooLargeMessage: `That file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit.`,
    };
  }

  if (matches(path, "/api/status")) {
    return {
      scope: "status",
      rules: [{ name: "min", limit: 60, windowMs: MINUTE }],
      maxBodyBytes: 1024,
      tooLargeMessage: "That request is too large.",
    };
  }

  return {
    scope: "api",
    rules: [{ name: "min", limit: 30, windowMs: MINUTE }],
    maxBodyBytes: MAX_JSON_BODY_BYTES,
    tooLargeMessage: "That request is too large.",
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type GuardCode = "forbidden-origin" | "payload-too-large" | "rate-limited";

export function guardError(
  status: number,
  code: GuardCode,
  error: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { error, code },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders,
      },
    },
  );
}

/** Same wording as the routes' own "rate-limited" failure. */
export const RATE_LIMITED_MESSAGE =
  "Too many requests in a short window. Wait a minute and try again.";
export const DAILY_LIMIT_MESSAGE =
  "You have reached today's limit for this feature on this deployment. Try again tomorrow.";

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export interface GuardOptions {
  isDev?: boolean;
  store?: RateLimitStore;
  env?: Env;
  now?: number;
}

/**
 * Returns a response to send instead of the route's, or null to let the
 * request through.
 */
export async function guardApiRequest(
  request: Request,
  options: GuardOptions = {},
): Promise<Response | null> {
  const env = options.env ?? process.env;
  const isDev = options.isDev ?? env.NODE_ENV === "development";
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return null;

  const origin = checkOrigin(
    { method, headers: request.headers, url: request.url },
    { isDev },
  );
  if (!origin.ok) {
    return guardError(403, "forbidden-origin", "This API only accepts requests from this site.");
  }

  const pathname = new URL(request.url).pathname;
  const policy = policyFor(pathname, env);

  if (!SAFE_METHODS.has(method)) {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > policy.maxBodyBytes) {
      return guardError(413, "payload-too-large", policy.tooLargeMessage);
    }
  }

  const store = options.store ?? getDefaultStore();
  const key = `${policy.scope}:${getClientIp(request.headers)}`;
  let result;
  try {
    result = await consume(store, key, policy.rules, options.now ?? Date.now());
  } catch (error) {
    // A broken limiter must not take the whole API down with it.
    console.warn("[api-guard] rate limiter failed; allowing request:", error);
    return null;
  }

  if (!result.allowed) {
    return guardError(
      429,
      "rate-limited",
      result.rule === "day" ? DAILY_LIMIT_MESSAGE : RATE_LIMITED_MESSAGE,
      { "Retry-After": String(result.retryAfter) },
    );
  }

  return null;
}
