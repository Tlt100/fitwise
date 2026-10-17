import { isAiConfigured } from "@/lib/ai/config";
import {
  FAILURE_MESSAGES,
  FAILURE_STATUS,
  GeminiError,
  generate,
  type GeminiContent,
} from "@/lib/ai/gemini";
import { CHAT_SYSTEM_PROMPT, buildChatContext } from "@/lib/ai/prompts";
import { checkChatRequest } from "@/lib/http/chat-request";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(code: GeminiError["code"], retryAfter?: number) {
  return NextResponse.json(
    { error: FAILURE_MESSAGES[code], code },
    {
      status: FAILURE_STATUS[code],
      headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
    },
  );
}

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return fail("not-configured");
  }

  // Origin, body size and per-IP rate limits are enforced for every /api
  // route by the guard in src/proxy.ts, before this handler runs.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // Roles other than user/assistant, oversized turns and a history that does
  // not end with the user's message are refused; an over-long history is
  // trimmed to its most recent turns.
  const checked = checkChatRequest(body);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error, code: "invalid-request" }, { status: 400 });
  }
  const parsed = checked.request;

  // The documents ride in as the opening exchange rather than in the system
  // prompt, so the model treats them as material to work from, not as rules.
  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: buildChatContext(parsed.resumeText, parsed.jobDescription) }],
    },
    {
      role: "model",
      parts: [
        {
          text: "I have read the resume and the posting. Ask me anything about this application.",
        },
      ],
    },
    ...checked.history.map<GeminiContent>((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
  ];

  let reply: string;
  try {
    reply = await generate({
      system: CHAT_SYSTEM_PROMPT,
      contents,
      temperature: 0.4,
      maxOutputTokens: 2048,
      timeoutMs: 45_000,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof GeminiError) return fail(error.code);
    return fail("unavailable");
  }

  return NextResponse.json(
    { reply },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
