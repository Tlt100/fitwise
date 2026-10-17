import {
  analysisSchema,
  geminiAnalysisSchema,
  type Analysis,
  type AnalyzeResponse,
} from "@/lib/ai/analysis-schema";
import { getRateLimitPerMinute, isAiConfigured } from "@/lib/ai/config";
import {
  FAILURE_MESSAGES,
  FAILURE_STATUS,
  GeminiError,
  generate,
} from "@/lib/ai/gemini";
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from "@/lib/ai/prompts";
import { verifyAnalysis } from "@/lib/ai/verify";
import { detectInjection } from "@/lib/ats/injection";
import {
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_RESUME_CHARS,
  MIN_JOB_DESCRIPTION_CHARS,
  MIN_RESUME_CHARS,
} from "@/lib/limits";
import { matchResumeToJob } from "@/lib/match/keywords";
import { composeScore } from "@/lib/match/score";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  resumeText: z.string().min(MIN_RESUME_CHARS).max(MAX_RESUME_CHARS),
  jobDescription: z
    .string()
    .min(MIN_JOB_DESCRIPTION_CHARS)
    .max(MAX_JOB_DESCRIPTION_CHARS),
  /** Optional ATS-readiness 0-100 from the client-side ATS check. */
  atsReadiness: z.number().min(0).max(100).optional(),
  /**
   * Optional integrity flag from the extract step's ATS check: hidden text or
   * instructions aimed at an AI screener were found in the uploaded file.
   */
  integrity: z
    .object({
      suspectedInjection: z.boolean(),
      hiddenSamples: z.array(z.string().max(400)).max(10).optional(),
    })
    .optional(),
});

/** Whole-request budget for model calls, inside the 60 s maxDuration. */
const MODEL_BUDGET_MS = 55_000;
/** Not worth starting a retry that cannot plausibly finish. */
const MIN_RETRY_MS = 8_000;

function fail(code: GeminiError["code"], retryAfter?: number) {
  return NextResponse.json(
    { error: FAILURE_MESSAGES[code], code },
    {
      status: FAILURE_STATUS[code],
      headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
    },
  );
}

function parseAnalysis(raw: string): Analysis | null {
  try {
    const result = analysisSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return fail("not-configured");
  }

  const limit = rateLimit(clientKey(request, "analyze"), getRateLimitPerMinute());
  if (!limit.allowed) {
    return fail("rate-limited", limit.retryAfter);
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "The resume or job description was missing, too short, or too long to analyse.",
        code: "invalid-request",
      },
      { status: 400 },
    );
  }

  // Deterministic first: the keyword facts are computed in code and handed to
  // the model to explain, so it has no reason to invent them.
  const match = matchResumeToJob(parsed.resumeText, parsed.jobDescription);
  // The client's flag covers hidden-text signals only visible in the original
  // file; the text-only scan here is a server-side backstop that cannot be
  // switched off by omitting the flag.
  const textScan = detectInjection(parsed.resumeText);
  const suspectedInjection =
    parsed.integrity?.suspectedInjection === true || textScan.suspectedInjection;
  const prompt = buildAnalysisPrompt(parsed.resumeText, parsed.jobDescription, {
    keywordFacts: match,
    integrity: suspectedInjection
      ? {
          suspectedInjection: true,
          hiddenSamples: [...(parsed.integrity?.hiddenSamples ?? []), ...textScan.hiddenSamples],
        }
      : null,
  });

  const deadline = Date.now() + MODEL_BUDGET_MS;
  let analysis: Analysis | null = null;

  // Structured output is reliable but not guaranteed, so the reply is
  // validated against the same contract, and a reply that fails validation
  // gets exactly one more attempt if there is time for it.
  for (let attempt = 0; attempt < 2 && !analysis; attempt += 1) {
    const remaining = deadline - Date.now();
    if (attempt > 0 && remaining < MIN_RETRY_MS) break;
    try {
      const raw = await generate({
        system: ANALYSIS_SYSTEM_PROMPT,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        responseSchema: geminiAnalysisSchema,
        // Low temperature: the same pair should read the same way twice.
        temperature: attempt === 0 ? 0.1 : 0,
        timeoutMs: remaining,
        // Stop paying for a generation nobody is waiting for.
        signal: request.signal,
      });
      analysis = parseAnalysis(raw);
    } catch (error) {
      if (error instanceof GeminiError) return fail(error.code);
      return fail("unavailable");
    }
  }

  if (!analysis) {
    return fail("bad-response");
  }

  const verified = verifyAnalysis(analysis, parsed.resumeText, match);
  const score = composeScore({
    keywordCoveragePct: match.coverage.weightedCoveragePct,
    requirements: verified.analysis.experienceAlignment,
    atsReadiness: parsed.atsReadiness,
  });

  const body: AnalyzeResponse = {
    analysis: verified.analysis,
    match,
    score,
    verification: verified.report,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
