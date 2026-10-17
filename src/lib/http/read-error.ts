/**
 * Turn a failed API response into a message for the UI.
 *
 * The routes always answer with `{ error }` JSON, but the platform in front of
 * them does not: a function timeout (504) or an oversized body (413) comes
 * back as plain text or HTML. Parsing that as JSON used to throw and surface as
 * "check your connection", which sent people chasing the wrong problem.
 */
export function messageForFailure(status: number, body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  if (status === 413) return "That file is too large to upload.";
  if (status === 429) return "Too many requests in a short window. Wait a minute and try again.";
  if (status === 504) return "The server took too long to respond. Try again.";
  if (status >= 500) return "The server ran into a problem. Try again in a moment.";
  return fallback;
}

/** Parse a response body as JSON, returning null instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `response.json()` that yields null for a non-JSON body. */
export async function readJson(response: Response): Promise<unknown> {
  return parseJson(await response.text());
}
