"use client";

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
import type { Analysis } from "@/lib/ai/analysis-schema";
import { cn } from "@/lib/cn";
import { buildDraft } from "@/lib/export/build-draft";
import { exportDocx, exportPdf } from "@/lib/export/export-document";
import { useSession } from "@/lib/session/session-context";
import { Check, Download, FileText, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

export function DraftWorkshop({ analysis }: { analysis: Analysis }) {
  const { resume, decisions, setDecision, draftSummary, setDraftSummary } = useSession();
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const rewrites = analysis.bulletRewrites;

  const accepted = useMemo(
    () =>
      rewrites
        .map((rewrite, index) => ({ rewrite, decision: decisions[String(index)] }))
        .filter(({ decision }) => decision?.status === "accepted")
        .map(({ rewrite, decision }) => ({
          original: rewrite.original,
          replacement: decision?.edited?.trim() || rewrite.suggested,
        })),
    [rewrites, decisions],
  );

  const draft = useMemo(() => {
    if (!resume) return null;
    const built = buildDraft(resume.text, accepted);
    const summary = draftSummary?.trim();
    // A summary picked in the Rewrites tab goes at the top, under no heading
    // of its own: most templates put it right below the contact block.
    return summary ? { ...built, text: `${summary}\n\n${built.text}` } : built;
  }, [resume, accepted, draftSummary]);

  async function runExport(kind: "docx" | "pdf") {
    if (!draft || !resume) return;
    setExporting(kind);
    setExportError(null);
    try {
      if (kind === "docx") {
        await exportDocx(draft.text, resume.name);
      } else {
        await exportPdf(draft.text, resume.name);
      }
    } catch {
      setExportError(
        "The file could not be generated in this browser. Copy the draft text below instead.",
      );
    } finally {
      setExporting(null);
    }
  }

  if (!resume) return null;

  return (
    <div className="space-y-6">
      {draftSummary !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>
              Chosen in the Rewrites tab. It is placed at the top of the draft
              below; edit it here or remove it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label htmlFor="draft-summary" className="sr-only">
              Summary for the top of the draft
            </label>
            <textarea
              id="draft-summary"
              value={draftSummary}
              onChange={(event) => setDraftSummary(event.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed"
            />
            <Button size="sm" variant="ghost" onClick={() => setDraftSummary(null)}>
              <Trash2 className="size-4" aria-hidden />
              Remove summary
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Suggested rewrites</CardTitle>
          <CardDescription>
            Each one is built from a line already in your resume. Accept what reads
            better, edit anything that is not quite right, and reject the rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rewrites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The analysis did not propose any bullet-level rewrites. That usually
              means the existing bullets already read clearly for this posting.
            </p>
          ) : (
            rewrites.map((rewrite, index) => {
              const key = String(index);
              const decision = decisions[key];
              const status = decision?.status ?? "pending";
              const value = decision?.edited ?? rewrite.suggested;

              return (
                <div
                  key={key}
                  className={cn(
                    "space-y-3 rounded-xl border p-4 transition-colors",
                    status === "accepted" && "border-positive/40 bg-positive-surface/40",
                    status === "rejected" && "border-border-subtle opacity-60",
                    status === "pending" && "border-border-subtle",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {rewrite.section}
                    </span>
                    {status !== "pending" ? (
                      <Badge tone={status === "accepted" ? "positive" : "neutral"}>
                        {status === "accepted" ? "Accepted" : "Rejected"}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Your current line
                      </p>
                      <p className="rounded-lg bg-surface-sunken p-3 text-sm leading-relaxed">
                        {rewrite.original}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`rewrite-${key}`}
                        className="text-xs font-semibold uppercase tracking-wide text-secondary"
                      >
                        Suggested — edit freely
                      </label>
                      <textarea
                        id={`rewrite-${key}`}
                        value={value}
                        onChange={(event) =>
                          setDecision(key, { edited: event.target.value })
                        }
                        rows={3}
                        className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed"
                      />
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">{rewrite.rationale}</p>

                  {rewrite.addsUnverifiedNumbers ? (
                    <Alert tone="caution" title="This rewrite adds figures your resume does not contain">
                      <p>
                        Check these before accepting, and replace them with your
                        real numbers or remove them:
                      </p>
                      {rewrite.unverifiedNumbers?.length ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {rewrite.unverifiedNumbers.map((value, i) => (
                            <li key={`${i}-${value}`}>
                              <Badge tone="caution">{value}</Badge>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={status === "accepted" ? "primary" : "outline"}
                      onClick={() => setDecision(key, { status: "accepted", edited: value })}
                    >
                      <Check className="size-4" aria-hidden />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant={status === "rejected" ? "danger" : "outline"}
                      onClick={() => setDecision(key, { status: "rejected" })}
                    >
                      <X className="size-4" aria-hidden />
                      Reject
                    </Button>
                    {value !== rewrite.suggested ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDecision(key, { edited: rewrite.suggested })}
                      >
                        <RotateCcw className="size-4" aria-hidden />
                        Reset text
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your revised draft</CardTitle>
          <CardDescription>
            Accepted rewrites folded into the extracted text. Your uploaded file is
            untouched — this exports as a separate document.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={accepted.length ? "positive" : "neutral"}>
              {accepted.length} of {rewrites.length} accepted
            </Badge>
            {draft && draft.unapplied.length ? (
              <Badge tone="caution">
                {draft.unapplied.length} could not be placed automatically
              </Badge>
            ) : null}
          </div>

          {draft && draft.unapplied.length ? (
            <Alert tone="caution" title="Some rewrites need placing by hand">
              <p>
                These lines could not be matched against the extracted text — usually
                because the original spans two lines in the PDF. Paste them in
                yourself after exporting:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {draft.unapplied.map((line, index) => (
                  // The model can quote the same line twice; keys must stay unique.
                  <li key={`${index}-${line}`} className="text-xs">
                    {line}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {exportError ? <Alert tone="negative">{exportError}</Alert> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void runExport("docx")} disabled={exporting !== null}>
              {exporting === "docx" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Export DOCX
            </Button>
            <Button
              variant="outline"
              onClick={() => void runExport("pdf")}
              disabled={exporting !== null}
            >
              {exporting === "pdf" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-4" aria-hidden />
              )}
              Export PDF
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The export carries your text, not your original formatting — extraction
            cannot recover fonts or layout. Treat it as content to paste back into your
            own template.
          </p>

          <details className="rounded-lg border border-border-subtle">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Preview the draft text
            </summary>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-border-subtle p-4 font-sans text-sm leading-relaxed">
              {draft?.text}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
