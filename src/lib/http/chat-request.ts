/**
 * Validation for `/api/chat` bodies. Kept out of the route file because a
 * Next route module may only export handlers and segment config.
 */
import {
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_RESUME_CHARS,
  MIN_RESUME_CHARS,
} from "@/lib/limits";
import { z } from "zod";

/**
 * Assistant turns are the model's own earlier replies echoed back by the
 * client. They can run longer than a typed message (up to 2048 output
 * tokens), so they get their own, larger cap.
 */
export const MAX_ASSISTANT_MESSAGE_CHARS = 12_000;

/**
 * Budget for the whole history. Older turns beyond it are dropped (oldest
 * first) rather than failing the request, so a long conversation keeps
 * working while the prompt stays bounded.
 */
export const MAX_CHAT_HISTORY_TOTAL_CHARS = 24_000;

// Only "user" and "assistant" are accepted, with no extra fields: a forged
// "system" or "model" turn is a schema failure, never passed to Gemini.
const messageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("user"),
    content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
  }),
  z.strictObject({
    role: z.literal("assistant"),
    content: z.string().trim().min(1).max(MAX_ASSISTANT_MESSAGE_CHARS),
  }),
]);

export const chatRequestSchema = z.object({
  resumeText: z.string().min(MIN_RESUME_CHARS).max(MAX_RESUME_CHARS),
  jobDescription: z.string().max(MAX_JOB_DESCRIPTION_CHARS).nullable(),
  messages: z.array(messageSchema).min(1).max(MAX_CHAT_HISTORY_MESSAGES),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatTurn = z.infer<typeof messageSchema>;

/**
 * Keep the most recent turns that fit the character budget. The final turn is
 * always kept, and the kept history never opens with an assistant turn,
 * because it follows the context preamble's model turn.
 */
export function trimHistory(
  messages: readonly ChatTurn[],
  budget: number = MAX_CHAT_HISTORY_TOTAL_CHARS,
): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (kept.length > 0 && used + message.content.length > budget) break;
    kept.unshift(message);
    used += message.content.length;
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}

export type ChatRequestCheck =
  | { ok: true; request: ChatRequest; history: ChatTurn[] }
  | { ok: false; error: string };

/** Parse a body and apply the history rules. */
export function checkChatRequest(body: unknown): ChatRequestCheck {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "That message could not be sent. Check the length and try again." };
  }
  const last = parsed.data.messages.at(-1);
  if (!last || last.role !== "user") {
    return { ok: false, error: "The last message must come from you." };
  }
  return { ok: true, request: parsed.data, history: trimHistory(parsed.data.messages) };
}
