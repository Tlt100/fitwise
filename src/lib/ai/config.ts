/**
 * Server-only AI configuration. Nothing here may be imported from a client
 * component: the key must never reach the bundle.
 */
import "server-only";

/**
 * Default model. Not the newest one: the flagship Flash models return 503
 * "high demand" often enough on the free tier that they are a poor default for
 * a request a person is waiting on. This one was verified to serve structured
 * output reliably; the newer models are reachable via GEMINI_MODEL.
 */
export const DEFAULT_MODEL = "gemini-3.5-flash";

/**
 * Fallbacks tried, in order, when the chosen model reports itself unavailable.
 * Every entry here was verified against the live API with this app's actual
 * response schema — models that 404 on generateContent are deliberately absent
 * even though the models list advertises them.
 */
export const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

/** Models verified to serve structured JSON output on the free tier. */
export const SUPPORTED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

export function getModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/** The chosen model first, then the fallbacks, with no repeats. */
export function getModelChain(): string[] {
  const primary = getModel();
  return [primary, ...FALLBACK_MODELS.filter((model) => model !== primary)];
}

/** Whether the AI features can run at all. Surfaced to the UI via /api/status. */
export function isAiConfigured(): boolean {
  return getApiKey() !== null;
}

/**
 * Overrides the Gemini endpoint. Exists so the analyze and chat routes can be
 * exercised end to end against a local stub without a real key or quota; in
 * production it is unset and the Google endpoint is used.
 */
export function getBaseUrl(): string {
  return (
    process.env.GEMINI_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta/models"
  );
}

export function getRateLimitPerMinute(): number {
  const raw = Number(process.env.AI_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}
