import { getRateLimitPerMinute, isAiConfigured } from "@/lib/ai/config";
import { REWRITE_SYSTEM_PROMPT, buildRewritePrompt } from "@/lib/ai/feature-prompts";
import {
  geminiRewriteSchema,
  groundRewrite,
  normalizeRewrite,
  parseModelJson,
  rewriteRequestSchema,
  type ParsedRewriteRequest,
} from "@/lib/ai/feature-schemas";
import {
  FAILURE_MESSAGES,
  FAILURE_STATUS,
  GeminiError,
  generate,
} from "@/lib/ai/gemini";
import { clientKey, rateLimit } from "@/lib/rate-limit";
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

  const limit = rateLimit(clientKey(request, "rewrite"), getRateLimitPerMinute());
  if (!limit.allowed) {
    return fail("rate-limited", limit.retryAfter);
  }

  let parsed: ParsedRewriteRequest;
  try {
    parsed = rewriteRequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: "The rewrite request was incomplete. Make sure a resume is loaded, then try again.",
        code: "invalid-request",
      },
      { status: 400 },
    );
  }

  let text: string;
  try {
    text = await generate({
      system: REWRITE_SYSTEM_PROMPT,
      contents: [{ role: "user", parts: [{ text: buildRewritePrompt(parsed) }] }],
      responseSchema: geminiRewriteSchema,
      temperature: 0.7,
      maxOutputTokens: 4096,
      timeoutMs: 45_000,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof GeminiError) return fail(error.code);
    return fail("unavailable");
  }

  const raw = normalizeRewrite(parseModelJson(text), parsed.kind);
  if (!raw) return fail("bad-response");

  return NextResponse.json(groundRewrite(raw, parsed.kind, parsed.resumeText), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
