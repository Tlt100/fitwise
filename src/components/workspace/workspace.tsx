"use client";

import { AtsReportCard, BulletLintCard } from "@/components/checks";
import { CoverLetterPanel, HistoryPanel, RewritePanel } from "@/components/features";
import { BulletRewritesCard } from "@/components/results/bullet-rewrites-card";
import { KeywordTable } from "@/components/results/keyword-table";
import { ResultsDashboard } from "@/components/results/results-dashboard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AssistantPanel } from "@/components/workspace/assistant-panel";
import { DraftWorkshop } from "@/components/workspace/draft-workshop";
import { JobDescriptionInput } from "@/components/workspace/job-description-input";
import { ResumeUpload } from "@/components/workspace/resume-upload";
import type { AnalyzeResponse } from "@/lib/ai/analysis-schema";
import { runAtsChecks } from "@/lib/ats/checks";
import { cn } from "@/lib/cn";
import { toHistoryEntry } from "@/lib/history";
import { messageForFailure, readJson } from "@/lib/http/read-error";
import { MIN_JOB_DESCRIPTION_CHARS } from "@/lib/limits";
import { lintBullets } from "@/lib/lint/bullets";
import { matchResumeToJob } from "@/lib/match/keywords";
import { composeScore } from "@/lib/match/score";
import { isAnalysisStale, useSession } from "@/lib/session/session-context";
import {
  ArrowRight,
  FilePenLine,
  History,
  LayoutDashboard,
  Mail,
  PenLine,
  Loader2,
  MessagesSquare,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

type Tab =
  | "setup"
  | "results"
  | "assistant"
  | "draft"
  | "cover-letter"
  | "rewrites"
  | "history";

const TABS: Array<{ id: Tab; label: string; Icon: typeof Settings2 }> = [
  { id: "setup", label: "Setup", Icon: Settings2 },
  { id: "results", label: "Results", Icon: LayoutDashboard },
  { id: "assistant", label: "Assistant", Icon: MessagesSquare },
  { id: "draft", label: "Draft", Icon: FilePenLine },
  { id: "cover-letter", label: "Cover letter", Icon: Mail },
  { id: "rewrites", label: "Rewrites", Icon: PenLine },
  { id: "history", label: "History & compare", Icon: History },
];

/** At most this many hidden-text samples are sent along with an analysis. */
const MAX_HIDDEN_SAMPLES = 5;

function isAnalyzeResponse(payload: unknown): payload is AnalyzeResponse {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Partial<AnalyzeResponse>;
  return Boolean(
    p.analysis && typeof p.analysis === "object" && p.score && typeof p.score === "object" && p.match,
  );
}

export function Workspace() {
  const session = useSession();
  const {
    resume,
    jobDescription,
    analysis,
    match,
    score,
    analyzedAt,
    analyzedJobDescription,
    hydrated,
    setAnalysis,
    setDraftSummary,
    clearEverything,
  } = session;

  // The deterministic checks come back with the extracted text. A resume
  // restored from a session written before they existed is checked here.
  const ats = useMemo(
    () => (resume ? (resume.ats ?? runAtsChecks(resume.text, resume.meta)) : null),
    [resume],
  );
  const bullets = useMemo(
    () => (resume ? (resume.bullets ?? lintBullets(resume.text)) : null),
    [resume],
  );

  // Keyword coverage is deterministic, so it is shown as soon as both texts
  // exist, before (or without) an AI analysis. Deferred so typing stays smooth.
  const deferredJobDescription = useDeferredValue(jobDescription);
  const instantMatch = useMemo(() => {
    const jd = deferredJobDescription.trim();
    if (!resume || jd.length < MIN_JOB_DESCRIPTION_CHARS) return null;
    return matchResumeToJob(resume.text, jd);
  }, [resume, deferredJobDescription]);

  // The score the results tab shows: the dashboard recomputes the composite
  // with the current ATS readiness, so history must record the same numbers.
  const displayScore = useMemo(() => {
    if (!analysis || !ats) return score;
    return composeScore({
      keywordCoveragePct: match?.coverage.weightedCoveragePct ?? null,
      requirements: analysis.experienceAlignment,
      atsReadiness: ats.score,
    });
  }, [analysis, ats, match, score]);

  // Keyed on analyzedAt: one analysis maps to one stable entry (same id and
  // timestamp), so "already saved" detection works across renders.
  const historyEntry = useMemo(() => {
    if (!analysis || !resume || !analyzedAt) return null;
    const component = (id: string) =>
      displayScore?.components.find((c) => c.id === id)?.score ?? undefined;
    const missing = match
      ? [
          ...match.coverage.requiredMissing,
          ...match.terms.filter((t) => t.status === "missing").map((t) => t.term),
        ]
      : undefined;
    return toHistoryEntry({
      id: `analysis-${analyzedAt}`,
      createdAt: analyzedAt,
      resumeText: resume.text,
      jobDescription: analyzedJobDescription ?? jobDescription,
      resumeFileName: resume.name,
      roleTitle: analysis.roleTitle,
      scores: {
        composite: displayScore?.composite ?? undefined,
        keywordCoverage: component("keywords") ?? match?.coverage.weightedCoveragePct ?? undefined,
        ats: component("ats") ?? ats?.score,
        evidence: component("requirements"),
      },
      missingKeywords: missing,
    });
  }, [analysis, resume, analyzedAt, analyzedJobDescription, jobDescription, displayScore, match, ats]);

  // null means "not chosen yet", which lets the landing tab be derived from
  // the restored session instead of corrected by an effect after mount.
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((response) => readJson(response))
      .then((status) => {
        if (cancelled) return;
        // Anything but an explicit "configured: true" reads as unavailable.
        setAiConfigured(
          Boolean(status && typeof status === "object" && "configured" in status && status.configured === true),
        );
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabAvailable: Record<Tab, boolean> = {
    setup: true,
    results: Boolean(analysis),
    assistant: Boolean(resume),
    draft: Boolean(analysis),
    "cover-letter": Boolean(resume),
    rewrites: Boolean(resume),
    history: true,
  };

  // Land on the results if a previous analysis survived a refresh. A chosen
  // tab whose content has gone (the resume was removed, the analysis cleared)
  // falls back to setup instead of leaving an empty panel selected.
  const tab: Tab =
    chosenTab && tabAvailable[chosenTab]
      ? chosenTab
      : hydrated && analysis && chosenTab === null
        ? "results"
        : "setup";

  const stale = isAnalysisStale(session);
  const jdReady = jobDescription.trim().length >= MIN_JOB_DESCRIPTION_CHARS;
  const canAnalyze = Boolean(resume) && jdReady && aiConfigured !== false;

  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;

    const reachable = TABS.filter((entry) => tabAvailable[entry.id]);
    const current = reachable.findIndex((entry) => entry.id === tab);
    if (current === -1) return;

    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? reachable.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % reachable.length
            : (current - 1 + reachable.length) % reachable.length;

    event.preventDefault();
    setTab(reachable[next].id);
    document.getElementById(`tab-${reachable[next].id}`)?.focus();
  }

  const runAnalysis = useCallback(async () => {
    if (!resume || !jdReady || running) return;
    // Captured now: the user can keep typing while the request runs, and the
    // result must be recorded against what was actually sent.
    const inputs = { resumeText: resume.text, jobDescription: jobDescription.trim() };
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...inputs,
          // The ATS readiness becomes the 15% component of the composite.
          atsReadiness: ats?.score,
          // Hidden text or instructions found in the file: the model is told
          // not to credit or follow them.
          integrity: ats
            ? {
                suspectedInjection: ats.suspectedInjection,
                hiddenSamples: ats.integrity.hiddenSamples
                  .slice(0, MAX_HIDDEN_SAMPLES)
                  .map((sample) => sample.slice(0, 400)),
              }
            : undefined,
        }),
      });
      const payload: unknown = await readJson(response);

      if (!response.ok || !isAnalyzeResponse(payload)) {
        setError(messageForFailure(response.status, payload, "The analysis failed."));
        return;
      }
      setAnalysis(payload, inputs);
      setTab("results");
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setRunning(false);
    }
  }, [resume, jobDescription, jdReady, running, setAnalysis, ats]);

  if (!hydrated) {
    return (
      <div className="container-app max-w-5xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container-app max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold">Your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Everything here lives in this browser tab until you clear it.
          </p>
        </div>
        {(resume || jobDescription) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearEverything();
              setTab("setup");
              setError(null);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Clear everything
          </Button>
        )}
      </div>

      {aiConfigured === false ? (
        <Alert tone="caution" title="AI analysis is not configured">
          <p>
            This deployment has no <code>GEMINI_API_KEY</code>, so the AI
            analysis, assistant, cover letter and rewrites are unavailable. The
            ATS parse check and bullet check still run on every upload. See the
            README for the two-minute setup.
          </p>
        </Alert>
      ) : null}

      {/* Tabs. Roving tabindex plus arrow keys, per the WAI-ARIA tabs pattern:
          Tab moves into and out of the strip, arrows move between tabs. */}
      <div
        role="tablist"
        aria-label="Workspace sections"
        className="flex gap-1 overflow-x-auto border-b border-border-subtle"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map(({ id, label, Icon }) => {
          const available = tabAvailable[id];
          return (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              type="button"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              disabled={!available}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                tab === id
                  ? "border-secondary text-secondary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                !available &&
                  "cursor-not-allowed opacity-40 hover:text-muted-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="panel-setup"
        aria-labelledby="tab-setup"
        hidden={tab !== "setup"}
      >
        {tab === "setup" ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="mr-2 text-muted-foreground">1.</span>Your
                  resume
                </CardTitle>
                <CardDescription>
                  PDF or DOCX. The text is extracted on our server and returned
                  to this page; the file is not stored.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResumeUpload />
              </CardContent>
            </Card>

            {ats && bullets ? (
              <section aria-labelledby="instant-checks" className="space-y-4">
                <div className="space-y-1">
                  <h2 id="instant-checks" className="font-display text-lg font-semibold">
                    Instant checks
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Computed from the extracted text with fixed rules: no AI, and
                    nothing sent anywhere. Worth fixing before you analyze.
                  </p>
                </div>
                <AtsReportCard report={ats} />
                <BulletLintCard report={bullets} />
              </section>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="mr-2 text-muted-foreground">2.</span>The job
                </CardTitle>
                <CardDescription>
                  Paste the posting you are applying for.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JobDescriptionInput />
              </CardContent>
            </Card>

            {instantMatch && instantMatch.terms.length > 0 ? (
              <section aria-labelledby="instant-keywords" className="space-y-4">
                <div className="space-y-1">
                  <h2 id="instant-keywords" className="font-display text-lg font-semibold">
                    Keyword coverage
                    {instantMatch.coverage.weightedCoveragePct !== null
                      ? `: ${Math.round(instantMatch.coverage.weightedCoveragePct)}%`
                      : null}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Terms from the posting matched against your resume with fixed
                    rules (aliases and word forms included). No AI, nothing sent.
                  </p>
                </div>
                <KeywordTable match={instantMatch} />
              </section>
            ) : null}

            <Card>
              <CardContent className="space-y-4 p-6 pt-6">
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-semibold">
                    <span className="mr-2 text-muted-foreground">3.</span>Run
                    the analysis
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Pressing this sends your resume text and the job description
                    to Google&apos;s Gemini API. Nothing leaves this page before
                    you do.
                  </p>
                </div>

                {error ? (
                  <Alert tone="negative" title="The analysis did not run">
                    {error}
                  </Alert>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    onClick={runAnalysis}
                    disabled={!canAnalyze && !running}
                    loading={running}
                  >
                    {running ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Analyzing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" aria-hidden />
                        {analysis ? "Run it again" : "Analyze my resume"}
                      </>
                    )}
                  </Button>
                  {analysis && !running ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setTab("results")}
                    >
                      View current results
                      <ArrowRight className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>

                {!canAnalyze && aiConfigured !== false ? (
                  <p className="text-sm text-muted-foreground">
                    {!resume
                      ? "Add a resume to continue."
                      : `The job description needs at least ${MIN_JOB_DESCRIPTION_CHARS} characters.`}
                  </p>
                ) : null}

                {running ? (
                  <div className="space-y-2" aria-live="polite">
                    <p className="text-sm text-muted-foreground">
                      Reading both documents and scoring the overlap. This
                      usually takes 15–30 seconds.
                    </p>
                    <Skeleton className="h-2 w-full" />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="panel-results"
        aria-labelledby="tab-results"
        hidden={tab !== "results"}
      >
        {tab === "results" && analysis ? (
          <div className="space-y-4">
            {stale ? (
              <Alert tone="caution" title="The job description has changed">
                <p>
                  These results were produced from the previous posting. Run the
                  analysis again to update them.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={runAnalysis}
                  loading={running}
                >
                  {running ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-4" aria-hidden />
                  )}
                  Re-run the analysis
                </Button>
              </Alert>
            ) : null}
            <ResultsDashboard
              analysis={analysis}
              generatedAt={analyzedAt}
              onAnalyzeAnother={() => setTab("setup")}
              match={match}
              score={score}
              resumeText={resume?.text ?? null}
              jobDescription={analyzedJobDescription}
              atsReadiness={ats?.score ?? null}
              atsSlot={ats ? <AtsReportCard report={ats} title="ATS readiness" /> : null}
              bulletSlot={
                <>
                  <BulletRewritesCard rewrites={analysis.bulletRewrites} />
                  {bullets ? <BulletLintCard report={bullets} /> : null}
                </>
              }
            />
          </div>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="panel-assistant"
        aria-labelledby="tab-assistant"
        hidden={tab !== "assistant"}
      >
        {tab === "assistant" && resume ? <AssistantPanel /> : null}
      </div>

      <div
        role="tabpanel"
        id="panel-draft"
        aria-labelledby="tab-draft"
        hidden={tab !== "draft"}
      >
        {tab === "draft" && analysis ? (
          <DraftWorkshop analysis={analysis} />
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="panel-cover-letter"
        aria-labelledby="tab-cover-letter"
        hidden={tab !== "cover-letter"}
      >
        {tab === "cover-letter" && resume ? (
          <CoverLetterPanel
            resumeText={resume.text}
            jobDescription={jobDescription}
            analysis={analysis ?? undefined}
          />
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="panel-rewrites"
        aria-labelledby="tab-rewrites"
        hidden={tab !== "rewrites"}
      >
        {tab === "rewrites" && resume ? (
          <RewritePanel
            resumeText={resume.text}
            jobDescription={jobDescription}
            analysis={analysis ?? undefined}
            // The draft is built on an analysis, so a summary can only be
            // placed in it once there is one.
            onInsertSummary={analysis ? (text) => setDraftSummary(text) : undefined}
          />
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="panel-history"
        aria-labelledby="tab-history"
        hidden={tab !== "history"}
      >
        {tab === "history" ? <HistoryPanel currentEntry={historyEntry} /> : null}
      </div>
    </div>
  );
}
