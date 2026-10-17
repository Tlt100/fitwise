import "server-only";
import { getApiKey, getBaseUrl, getModelChain } from "@/lib/ai/config";

export type GeminiPart = { text: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiFailure = {
  /** Stable code the route maps to an HTTP status and a user-facing message. */
  code:
    | "not-configured"
    | "invalid-key"
    | "rate-limited"
    | "quota-exhausted"
    | "timeout"
    | "blocked"
    | "unavailable"
    | "bad-response";
  message: string;
};

export class GeminiError extends Error implements GeminiFailure {
  code: GeminiFailure["code"];
  constructor(code: GeminiFailure["code"], message: string) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
  }
}

/** Human-readable text for each failure, safe to show in the UI. */
export const FAILURE_MESSAGES: Record<GeminiFailure["code"], string> = {
  "not-configured":
    "AI analysis is not configured on this deployment. A GEMINI_API_KEY environment variable is required.",
  "invalid-key":
    "The configured Gemini API key was rejected. Check GEMINI_API_KEY in your environment.",
  "rate-limited":
    "Too many requests in a short window. Wait a minute and try again.",
  "quota-exhausted":
    "The Gemini free-tier quota for this key is used up. It resets daily, or you can add billing in Google AI Studio.",
  timeout: "The model took too long to respond. Try again.",
  blocked:
    "The model declined to answer for this content. Try rephrasing, or check the document for unexpected text.",
  unavailable: "Gemini is temporarily unavailable. Try again in a moment.",
  "bad-response":
    "The model returned something we could not read. Try running the analysis again.",
};

export const FAILURE_STATUS: Record<GeminiFailure["code"], number> = {
  "not-configured": 503,
  "invalid-key": 500,
  "rate-limited": 429,
  "quota-exhausted": 429,
  timeout: 504,
  blocked: 422,
  unavailable: 503,
  "bad-response": 502,
};

interface GenerateOptions {
  system: string;
  contents: GeminiContent[];
  /** Present for analysis, absent for chat. */
  responseSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Gemini's enum status (e.g. "INVALID_ARGUMENT"), never its free-text message. */
function errorStatusOf(body: string): string {
  try {
    const status = (JSON.parse(body) as { error?: { status?: unknown } })?.error?.status;
    return typeof status === "string" && /^[A-Z_]{1,40}$/.test(status) ? status : "unknown";
  } catch {
    return "unknown";
  }
}

export function mapHttpError(status: number, body: string): GeminiError {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) {
    return new GeminiError("invalid-key", FAILURE_MESSAGES["invalid-key"]);
  }
  if (status === 401 || status === 403) {
    return new GeminiError("invalid-key", FAILURE_MESSAGES["invalid-key"]);
  }
  if (status === 429) {
    const exhausted = /quota|exhausted|PerDay/i.test(body);
    const code = exhausted ? "quota-exhausted" : "rate-limited";
    return new GeminiError(code, FAILURE_MESSAGES[code]);
  }
  // 404 means this model name is not served (retired, or a typo in
  // GEMINI_MODEL). That is specific to the model, so it is classed as
  // unavailable and the next model in the chain gets a turn.
  if (status === 404 || status === 500 || status === 502 || status === 503 || status === 504) {
    return new GeminiError("unavailable", FAILURE_MESSAGES.unavailable);
  }
  return new GeminiError("bad-response", FAILURE_MESSAGES["bad-response"]);
}

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

/**
 * One attempt against one model. `timeoutMs` here is what is left of the
 * overall budget, and it covers reading the body as well as the headers: a
 * stalled response stream must not outlive the route's maxDuration.
 */
async function generateOnce(
  model: string,
  key: string,
  timeoutMs: number,
  {
    system,
    contents,
    responseSchema,
    temperature = 0.3,
    maxOutputTokens = 8192,
    signal,
  }: GenerateOptions,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(`${getBaseUrl()}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens,
            ...(responseSchema
              ? { responseMimeType: "application/json", responseSchema }
              : {}),
          },
        }),
      });
      raw = await response.text();
    } catch {
      if (controller.signal.aborted) {
        throw new GeminiError("timeout", FAILURE_MESSAGES.timeout);
      }
      throw new GeminiError("unavailable", FAILURE_MESSAGES.unavailable);
    }

    if (!response.ok) {
      // The body is read for classification only. It is never logged or
      // returned: error envelopes can echo the prompt, which contains the resume.
      // Only the HTTP status and Gemini's enum status code are logged, so a
      // failing deployment can still be diagnosed from the function logs.
      console.error(`Gemini HTTP ${response.status} (${errorStatusOf(raw)}) from ${model}`);
      throw mapHttpError(response.status, raw);
    }

    return readCandidateText(raw);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Pull the model's text out of a successful generateContent response body. */
export function readCandidateText(raw: string): string {
  let payload: GeminiPayload | null;
  try {
    payload = JSON.parse(raw) as GeminiPayload | null;
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== "object") {
    throw new GeminiError("bad-response", FAILURE_MESSAGES["bad-response"]);
  }
  if (payload.promptFeedback?.blockReason) {
    throw new GeminiError("blocked", FAILURE_MESSAGES.blocked);
  }

  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (candidate?.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason) && !text.trim()) {
    throw new GeminiError("blocked", FAILURE_MESSAGES.blocked);
  }
  if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
    throw new GeminiError("blocked", FAILURE_MESSAGES.blocked);
  }
  if (!text.trim()) {
    throw new GeminiError("bad-response", FAILURE_MESSAGES["bad-response"]);
  }

  return text;
}

/**
 * Single call into Gemini. Returns the model's text; the caller decides whether
 * that text is JSON. Errors are normalised so route handlers never have to
 * parse Google's error envelope, and the request body is never logged.
 *
 * Free-tier Flash models report 503 "high demand" often enough that a single
 * attempt would fail a real user's analysis for reasons that have nothing to do
 * with them, so an unavailable model falls through to the next verified one.
 * Only availability is retried: a bad key or an exhausted quota will fail the
 * same way on every model, so those surface immediately.
 *
 * `timeoutMs` is the budget for the whole chain, not for each attempt, so a
 * run of slow 503s cannot push the request past the route's maxDuration.
 */
export async function generate(options: GenerateOptions): Promise<string> {
  const key = getApiKey();
  if (!key) {
    throw new GeminiError("not-configured", FAILURE_MESSAGES["not-configured"]);
  }

  const chain = getModelChain();
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let lastError: GeminiError = new GeminiError(
    "unavailable",
    FAILURE_MESSAGES.unavailable,
  );

  for (const model of chain) {
    const remaining = deadline - Date.now();
    // Not worth starting an attempt that cannot plausibly finish.
    if (remaining < 1_000) {
      throw new GeminiError("timeout", FAILURE_MESSAGES.timeout);
    }
    try {
      return await generateOnce(model, key, remaining, options);
    } catch (error) {
      if (!(error instanceof GeminiError) || error.code !== "unavailable") {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}
