"use client";

import { CopyButton } from "@/components/features/copy-button";
import { SegmentedField } from "@/components/features/field";
import { postJson } from "@/components/features/post-json";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  REWRITE_MAX_CHARS,
  summarizeAnalysis,
  type RewriteKind,
  type RewriteRequest,
  type RewriteResponse,
} from "@/lib/ai/feature-schemas";
import { MIN_RESUME_CHARS } from "@/lib/limits";
import { AlertTriangle, ArrowDownToLine, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

export interface RewritePanelProps {
  resumeText: string | null | undefined;
  /** Optional: when present, variants lean toward this posting. */
  jobDescription?: string | null;
  analysis?: unknown;
  /** Shown as an "Insert" button on summary variants when provided. */
  onInsertSummary?: (text: string) => void;
  /** Which kind is selected first. */
  initialKind?: RewriteKind;
}

const KINDS: { value: RewriteKind; label: string }[] = [
  { value: "summary", label: "Resume summary" },
  { value: "linkedin-headline", label: "LinkedIn headline" },
  { value: "linkedin-about", label: "LinkedIn About" },
];

function isRewriteResponse(payload: unknown): payload is RewriteResponse {
  return (
    !!payload &&
    typeof payload === "object" &&
    Array.isArray((payload as RewriteResponse).variants) &&
    Array.isArray((payload as RewriteResponse).checks)
  );
}

export function RewritePanel({
  resumeText,
  jobDescription,
  analysis,
  onInsertSummary,
  initialKind = "summary",
}: RewritePanelProps) {
  const [kind, setKind] = useState<RewriteKind>(initialKind);
  const [useJob, setUseJob] = useState(true);
  const [results, setResults] = useState<Partial<Record<RewriteKind, RewriteResponse>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inserted, setInserted] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const resume = resumeText?.trim() ?? "";
  const posting = jobDescription?.trim() ?? "";
  const result = results[kind];

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (resume.length < MIN_RESUME_CHARS || loading) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const requested = kind;
    setLoading(true);
    setError(null);
    setInserted(null);

    const body: RewriteRequest = {
      kind: requested,
      resumeText: resume,
      jobDescription: useJob && posting ? posting : null,
      analysisSummary: useJob ? summarizeAnalysis(analysis) : undefined,
    };
    const response = await postJson(
      "/api/rewrite",
      body,
      isRewriteResponse,
      "The rewrite could not be generated.",
      current.signal,
    );
    if (controller.current !== current) return;
    setLoading(false);
    if (!response.ok) {
      if (!response.aborted) setError(response.error);
      return;
    }
    setResults((prev) => ({ ...prev, [requested]: response.data }));
  }

  const kindLabel = KINDS.find((k) => k.value === kind)?.label ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary and LinkedIn rewrites</CardTitle>
        <CardDescription>
          Three takes on each, written only from your resume. Anything we could not trace back to it
          is flagged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={generate} className="space-y-5">
          <SegmentedField legend="What to write" name="rewrite-kind" value={kind} options={KINDS} onChange={setKind} />
          {posting ? (
            <label className="flex items-start gap-3 rounded-lg bg-surface-sunken p-3 text-sm">
              <input
                type="checkbox"
                checked={useJob}
                onChange={(e) => setUseJob(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-secondary)]"
              />
              <span>
                <span className="font-medium">Tailor to the job description</span>
                <span className="block text-muted-foreground">
                  Off writes a general version for your profile and keeps the posting out of the request.
                </span>
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={resume.length < MIN_RESUME_CHARS && !loading} loading={loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              {loading ? "Writing..." : result ? `Regenerate ${kindLabel.toLowerCase()}` : `Write ${kindLabel.toLowerCase()}`}
            </Button>
            {resume.length < MIN_RESUME_CHARS ? (
              <p className="text-sm text-muted-foreground">Upload your resume first.</p>
            ) : null}
          </div>
        </form>

        <div aria-live="polite" className="space-y-4">
          {loading ? <p className="sr-only">Generating variants.</p> : null}
          {error ? <Alert tone="negative">{error}</Alert> : null}
          {result ? (
            <>
              <ol className="space-y-3">
                {result.variants.map((text, index) => {
                  const check = result.checks[index];
                  return (
                    <li key={`${kind}-${index}`} className="space-y-3 rounded-lg border border-border-subtle p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Option {index + 1}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {text.length} / {REWRITE_MAX_CHARS[result.kind]} characters
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
                      {check?.flagged ? (
                        <div className="flex gap-2 rounded-md bg-caution-surface p-3 text-xs text-caution-foreground">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <div className="space-y-1">
                            {check.unsupportedNumbers.length > 0 ? (
                              <p>
                                Contains {check.unsupportedNumbers.map((n) => `"${n}"`).join(", ")}, which
                                is not in your resume. Remove it or add the real figure.
                              </p>
                            ) : null}
                            {check.unsupportedQuotes.length > 0 ? (
                              <p>Some of what this draws on could not be found in your resume. Read it carefully.</p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <Badge tone="positive">Matched to your resume</Badge>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <CopyButton text={text} />
                        {onInsertSummary && result.kind === "summary" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              onInsertSummary(text);
                              setInserted(index);
                            }}
                          >
                            <ArrowDownToLine className="size-4" aria-hidden />
                            {inserted === index ? "Inserted" : "Use in my resume"}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {result.rationale ? (
                <p className="text-sm text-muted-foreground">{result.rationale}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
