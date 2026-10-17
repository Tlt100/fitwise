import { messageForFailure, readJson } from "@/lib/http/read-error";

export type PostResult<T> = { ok: true; data: T } | { ok: false; error: string; aborted?: boolean };

/** POST JSON and map every failure to a message the UI can show as-is. */
export async function postJson<T>(
  url: string,
  body: unknown,
  isValid: (payload: unknown) => payload is T,
  fallback: string,
  signal?: AbortSignal,
): Promise<PostResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const payload = await readJson(response);
    if (!response.ok || !isValid(payload)) {
      return { ok: false, error: messageForFailure(response.status, payload, fallback) };
    }
    return { ok: true, data: payload };
  } catch {
    if (signal?.aborted) return { ok: false, error: "", aborted: true };
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}
