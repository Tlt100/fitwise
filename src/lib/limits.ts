/**
 * Shared limits. These are enforced twice on purpose: once in the browser so
 * people get an instant, specific message, and once on the server because the
 * browser check is a convenience, not a control.
 */

/**
 * 4 MB, not 5: Vercel rejects function request bodies over 4.5 MB with its own
 * plain-text 413 before the route runs, so a 4.6 MB file would pass the
 * browser check and then fail with an unhelpful error. This leaves headroom
 * for the multipart envelope.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx"] as const;

/** Below this, the upload almost certainly failed to extract anything useful. */
export const MIN_RESUME_CHARS = 200;
export const MAX_RESUME_CHARS = 30_000;

export const MIN_JOB_DESCRIPTION_CHARS = 120;
export const MAX_JOB_DESCRIPTION_CHARS = 20_000;

export const MAX_CHAT_MESSAGE_CHARS = 2_000;
export const MAX_CHAT_HISTORY_MESSAGES = 20;

/** Requests per IP per minute against the AI routes. */
export const DEFAULT_AI_RATE_LIMIT = 10;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  // Number() drops a trailing ".0", so the limit reads "4 MB", not "4.0 MB".
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}
