"use client";

import { CopyButton } from "@/components/features/copy-button";
import { exportTextDocx, exportTextPdf } from "@/components/features/export-text";
import { SegmentedField, SelectField, TextField } from "@/components/features/field";
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
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_WHY_COMPANY_CHARS,
  MIN_FEATURE_JOB_DESCRIPTION_CHARS,
  summarizeAnalysis,
  type CoverLetterLength,
  type CoverLetterRequest,
  type CoverLetterResponse,
  type CoverLetterTone,
  type GroundingNote,
} from "@/lib/ai/feature-schemas";
import { MIN_RESUME_CHARS } from "@/lib/limits";
import { FileDown, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

export interface CoverLetterPanelProps {
  /** Extracted resume text; null/empty disables generation. */
  resumeText: string | null | undefined;
  jobDescription: string | null | undefined;
  /** The analyze response, used only to steer emphasis. Any shape is accepted. */
  analysis?: unknown;
}

const TONES: { value: CoverLetterTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
];

const LENGTHS: { value: string; label: string }[] = [
  { value: "150", label: "Short (~150 words)" },
  { value: "250", label: "Standard (~250 words)" },
  { value: "350", label: "Detailed (~350 words)" },
];

function isCoverLetterResponse(payload: unknown): payload is CoverLetterResponse {
  return (
    !!payload &&
    typeof payload === "object" &&
    Array.isArray((payload as CoverLetterResponse).paragraphs) &&
    Array.isArray((payload as CoverLetterResponse).notes)
  );
}

function noteText(note: GroundingNote): string {
  switch (note.kind) {
    case "unsupported-claim":
      return note.removedSentence
        ? `Removed a sentence claiming "${note.claim}" because it could not be matched to your resume.`
        : `Check "${note.claim}": it could not be matched to a line in your resume.`;
    case "unsupported-number":
      return `Paragraph ${note.paragraph + 1} mentions "${note.value}", which is not in your resume or your notes. Confirm or remove it.`;
    case "missing-why-company":
      return "You did not say why you want this company, so the letter does not either. Add your own reasons below and regenerate, or write that part yourself.";
  }
}

export function CoverLetterPanel({ resumeText, jobDescription, analysis }: CoverLetterPanelProps) {
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [length, setLength] = useState<CoverLetterLength>(250);
  const [companyName, setCompanyName] = useState("");
  const [hiringManager, setHiringManager] = useState("");
  const [whyThisCompany, setWhyThisCompany] = useState("");

  const [letter, setLetter] = useState("");
  const [result, setResult] = useState<CoverLetterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const resume = resumeText?.trim() ?? "";
  const posting = jobDescription?.trim() ?? "";
  const missingInput =
    resume.length < MIN_RESUME_CHARS
      ? "Upload your resume first."
      : posting.length < MIN_FEATURE_JOB_DESCRIPTION_CHARS
        ? "Paste the job description first."
        : null;

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (missingInput || loading) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(null);

    const body: CoverLetterRequest = {
      resumeText: resume,
      jobDescription: posting,
      analysisSummary: summarizeAnalysis(analysis),
      options: {
        tone,
        length,
        companyName: companyName || undefined,
        hiringManager: hiringManager || undefined,
        whyThisCompany: whyThisCompany || undefined,
      },
    };
    const response = await postJson(
      "/api/cover-letter",
      body,
      isCoverLetterResponse,
      "The cover letter could not be generated.",
      current.signal,
    );
    if (controller.current !== current) return;
    setLoading(false);
    if (!response.ok) {
      if (!response.aborted) setError(response.error);
      return;
    }
    setResult(response.data);
    setLetter(response.data.paragraphs.join("\n\n"));
  }

  async function exportAs(kind: "docx" | "pdf") {
    setExporting(kind);
    setError(null);
    const name = `Cover letter${companyName.trim() ? ` - ${companyName.trim()}` : ""}`;
    try {
      await (kind === "docx" ? exportTextDocx(letter, name) : exportTextPdf(letter, name));
    } catch {
      setError("The file could not be created. Copy the text instead.");
    } finally {
      setExporting(null);
    }
  }

  const flagged = result?.notes.filter((n) => n.kind !== "missing-why-company") ?? [];
  const missingWhy = result?.notes.some((n) => n.kind === "missing-why-company");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover letter</CardTitle>
        <CardDescription>
          Drafted only from what your resume says. Every claim is checked against your resume
          before you see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={generate} className="space-y-5">
          <SegmentedField legend="Tone" name="cover-letter-tone" value={tone} options={TONES} onChange={setTone} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Length"
              value={String(length)}
              options={LENGTHS}
              onChange={(e) => setLength(Number(e.target.value) as CoverLetterLength)}
            />
            <TextField
              label="Company (optional)"
              value={companyName}
              maxLength={120}
              autoComplete="organization"
              onChange={(e) => setCompanyName(e.target.value)}
            />
            <TextField
              label="Hiring manager (optional)"
              value={hiringManager}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setHiringManager(e.target.value)}
            />
          </div>
          <Textarea
            label="Why this company? (optional, in your words)"
            hint="This is the only source for anything the letter says about the company. Leave it empty and the letter will not make anything up."
            value={whyThisCompany}
            maxLength={MAX_WHY_COMPANY_CHARS}
            counter={{ value: whyThisCompany.length, max: MAX_WHY_COMPANY_CHARS }}
            onChange={(e) => setWhyThisCompany(e.target.value)}
            className="min-h-24"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!!missingInput && !loading} loading={loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              {loading ? "Writing..." : result ? "Regenerate" : "Generate cover letter"}
            </Button>
            {missingInput ? <p className="text-sm text-muted-foreground">{missingInput}</p> : null}
          </div>
        </form>

        <div id="cover-letter-status" aria-live="polite" className="space-y-4">
          {loading ? <p className="sr-only">Generating your cover letter.</p> : null}
          {error ? <Alert tone="negative">{error}</Alert> : null}

          {result ? (
            <>
              {flagged.length > 0 ? (
                <Alert tone="caution" title="Review before sending">
                  <ul className="list-disc space-y-1 pl-4">
                    {flagged.map((note, i) => (
                      <li key={i}>{noteText(note)}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert tone="positive" title="Every claim matched your resume">
                  {result.claimsUsed.length} claim{result.claimsUsed.length === 1 ? "" : "s"} checked
                  against your resume text.
                </Alert>
              )}
              {missingWhy ? <Alert tone="info">{noteText({ kind: "missing-why-company" })}</Alert> : null}

              <Textarea
                label="Your cover letter (editable)"
                value={letter}
                onChange={(e) => setLetter(e.target.value)}
                className="min-h-96"
              />

              <div className="flex flex-wrap gap-2">
                <CopyButton text={letter} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportAs("docx")}
                  disabled={!letter.trim() || exporting !== null}
                >
                  <FileDown className="size-4" aria-hidden />
                  {exporting === "docx" ? "Preparing..." : "Word (.docx)"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportAs("pdf")}
                  disabled={!letter.trim() || exporting !== null}
                >
                  <FileDown className="size-4" aria-hidden />
                  {exporting === "pdf" ? "Preparing..." : "PDF"}
                </Button>
              </div>

              {result.claimsUsed.length > 0 ? (
                <details className="rounded-lg border border-border-subtle p-4 text-sm">
                  <summary className="flex cursor-pointer items-center gap-2 font-medium">
                    <ShieldCheck className="size-4 text-positive" aria-hidden />
                    Where each claim comes from
                    <Badge tone="positive">{result.claimsUsed.length}</Badge>
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {result.claimsUsed.map((c, i) => (
                      <li key={i} className="space-y-1">
                        <p>{c.claim}</p>
                        <p className="border-l-2 border-positive/40 pl-3 text-muted-foreground">
                          &ldquo;{c.resumeQuote}&rdquo;
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
