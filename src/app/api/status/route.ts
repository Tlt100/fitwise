import { getModel, isAiConfigured } from "@/lib/ai/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AiStatus = {
  configured: boolean;
  /** Model name only. The key itself never leaves the server. */
  model: string | null;
};

/**
 * Lets the UI say "AI analysis is not configured" truthfully, instead of
 * offering a button that can only fail.
 */
export async function GET() {
  const configured = isAiConfigured();
  const body: AiStatus = { configured, model: configured ? getModel() : null };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
