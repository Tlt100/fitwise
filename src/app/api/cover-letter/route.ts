import { getRateLimitPerMinute, isAiConfigured } from "@/lib/ai/config";
import {
  COVER_LETTER_SYSTEM_PROMPT,
  buildCoverLetterPrompt,
} from "@/lib/ai/feature-prompts";
import {
  coverLetterRequestSchema,
  geminiCoverLetterSchema,
  groundCoverLetter,
  normalizeCoverLetter,
  parseModelJson,
  type CoverLetterResponse,
  type ParsedCoverLetterRequest,
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

  const limit = rateLimit(clientKey(request, "cover-letter"), getRateLimitPerMinute());
  if (!limit.allowed) {
    return fail("rate-limited", limit.retryAfter);
  }

  let parsed: ParsedCoverLetterRequest;
  try {
    parsed = coverLetterRequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "The cover letter request was incomplete. Make sure a resume and a job description are loaded, then try again.",
        code: "invalid-request",
      },
      { status: 400 },
    );
  }

  let text: string;
  try {
    text = await generate({
      system: COVER_LETTER_SYSTEM_PROMPT,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildCoverLetterPrompt({
                resumeText: parsed.resumeText,
                jobDescription: parsed.jobDescription,
                analysisSummary: parsed.analysisSummary,
                options: parsed.options,
              }),
            },
          ],
        },
      ],
      responseSchema: geminiCoverLetterSchema,
      temperature: 0.5,
      maxOutputTokens: 4096,
      timeoutMs: 50_000,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof GeminiError) return fail(error.code);
    return fail("unavailable");
  }

  const letter = normalizeCoverLetter(parseModelJson(text));
  if (!letter) return fail("bad-response");

  // Numbers the user typed themselves (company notes, names) are allowed.
  const { companyName, hiringManager, whyThisCompany } = parsed.options;
  const userText = [companyName, hiringManager, whyThisCompany].filter(Boolean).join("\n");
  const result: CoverLetterResponse = groundCoverLetter(letter, parsed.resumeText, userText);
  if (!whyThisCompany) result.notes.push({ kind: "missing-why-company" });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
