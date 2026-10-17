"use client";

import { BulletRewritesCard } from "@/components/results/bullet-rewrites-card";
import { KeywordTable } from "@/components/results/keyword-table";
import { ScoreArc, ScoreBar } from "@/components/results/score-arc";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { Analysis } from "@/lib/ai/analysis-schema";
import { cn } from "@/lib/cn";
import { matchResumeToJob, type MatchResult } from "@/lib/match/keywords";
import { composeScore, type CompositeScore } from "@/lib/match/score";
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Info,
  Quote,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

const importanceTone: Record<string, BadgeTone> = {
  critical: "negative",
  important: "caution",
  "nice-to-have": "neutral",
};

const importanceLabel: Record<string, string> = {
  critical: "Critical",
  important: "Important",
  "nice-to-have": "Nice to have",
};

const priorityTone: Record<string, BadgeTone> = {
  high: "negative",
  medium: "caution",
  low: "neutral",
};

const effortLabel: Record<string, string> = {
  quick: "Under 10 minutes",
  moderate: "An hour or so",
  substantial: "Ongoing work",
};

const statusMeta = {
  met: { tone: "positive" as BadgeTone, label: "Met", Icon: CircleCheck },
  partial: { tone: "caution" as BadgeTone, label: "Partial", Icon: CircleDashed },
  "not-evident": { tone: "negative" as BadgeTone, label: "Not evident", Icon: CircleSlash },
};

export interface ResultsDashboardProps {
  analysis: Analysis;
  generatedAt: string | null;
  onAnalyzeAnother: () => void;
  /** Deterministic keyword match from AnalyzeResponse.match. */
  match?: MatchResult | null;
  /** Composite score from AnalyzeResponse.score. */
  score?: CompositeScore | null;
  /**
   * Fallback inputs: when `match` is absent (e.g. an analysis restored from an
   * older session), the match is recomputed in the browser from these.
   */
  resumeText?: string | null;
  jobDescription?: string | null;
  /**
   * ATS readiness 0-100 from a client-side check. When supplied, the composite
   * is recomputed here so it includes the ATS component.
   */
  atsReadiness?: number | null;
  /** Rendered right under the score card (e.g. an ATS-readiness card). */
  atsSlot?: ReactNode;
  /**
   * Replaces the built-in "Suggested rewrites" card (e.g. with an interactive
   * bullet workshop). Use BulletRewritesCard to keep the default.
   */
  bulletSlot?: ReactNode;
}

export function ResultsDashboard({
  analysis,
  generatedAt,
  onAnalyzeAnother,
  match: matchProp,
  score: scoreProp,
  resumeText,
  jobDescription,
  atsReadiness,
  atsSlot,
  bulletSlot,
}: ResultsDashboardProps) {
  const match = useMemo<MatchResult | null>(() => {
    if (matchProp) return matchProp;
    if (resumeText && jobDescription) return matchResumeToJob(resumeText, jobDescription);
    return null;
  }, [matchProp, resumeText, jobDescription]);

  const score = useMemo<CompositeScore>(() => {
    const needsRecompute =
      !scoreProp || (atsReadiness !== undefined && atsReadiness !== null) || (!matchProp && match);
    if (scoreProp && !needsRecompute) return scoreProp;
    return composeScore({
      keywordCoveragePct: match?.coverage.weightedCoveragePct ?? null,
      requirements: analysis.experienceAlignment,
      atsReadiness: atsReadiness ?? null,
    });
  }, [scoreProp, matchProp, match, atsReadiness, analysis.experienceAlignment]);

  const verifiedCount = analysis.matchedSkills.filter((s) => s.verified === true).length;
  const checked = analysis.matchedSkills.some((s) => s.verified !== undefined);

  return (
    <div className="space-y-6">
      {/* Keys pair the index with the text: the model can repeat a skill,
          keyword or question, and duplicate keys make React drop or merge rows. */}

      {/* Score */}
      <Card>
        <CardContent className="grid gap-8 p-6 pt-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <ScoreArc score={score.composite} label={score.label} />
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">How well your resume evidences</p>
              <h2 className="font-display text-xl font-bold">{analysis.roleTitle}</h2>
            </div>
            <div className="space-y-3">
              {score.components.map((c) => (
                <div key={c.id} className="space-y-1">
                  <ScoreBar
                    name={c.label}
                    score={c.score}
                    suffix={c.score === null ? undefined : `${Math.round(c.effectiveWeight * 100)}% of score`}
                  />
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              ))}
            </div>
            <Disclosure summary={<span className="text-sm font-medium">How this score is computed</span>}>
              <div className="space-y-2">
                <p>{score.formula}</p>
                <p>
                  The model never supplies this number. Its only input is the met / partial /
                  not-evident judgement on each requirement below, which you can check against
                  your own resume.
                </p>
              </div>
            </Disclosure>
            <div className="flex items-start gap-2 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <p>
                This measures how much of what the posting asks for your resume visibly
                supports. It is not a prediction about hiring, and no employer sees it. Run the
                same resume against two postings and the difference between the scores is more
                meaningful than either number alone.
              </p>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{analysis.scoreRationale}</p>
            {generatedAt ? (
              <p className="text-xs text-muted-foreground">
                Generated {new Date(generatedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {atsSlot}

      {/* Keywords */}
      <Card>
        <CardHeader>
          <CardTitle>Keywords from the posting</CardTitle>
          <CardDescription>
            {match?.coverage.weightedCoveragePct !== null && match?.coverage.weightedCoveragePct !== undefined
              ? `${match.coverage.weightedCoveragePct}% weighted coverage: ${match.coverage.exactCount} exact, ${match.coverage.variantCount} variant, ${match.coverage.missingCount} missing.`
              : "Which of the posting's skills and tools appear in your resume, and where."}
            {match?.coverage.requiredMissing.length
              ? ` Required and missing: ${match.coverage.requiredMissing.slice(0, 6).join(", ")}${match.coverage.requiredMissing.length > 6 ? "…" : ""}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {match ? (
            <KeywordTable match={match} guidance={analysis.keywords} />
          ) : (
            <p className="text-sm text-muted-foreground">
              The keyword match is not available for this analysis. Run it again to see it.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Requirement by requirement */}
      {analysis.experienceAlignment.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Requirement by requirement</CardTitle>
            <CardDescription>
              Each stated requirement, how central the posting makes it, and whether your resume
              shows it. These judgements feed the requirement-evidence part of the score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Requirements, importance, status and explanation</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border-subtle">
                    <th scope="col" className="py-2 pr-3 font-medium">Requirement</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Importance</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.experienceAlignment.map((item, index) => {
                    const meta = statusMeta[item.status];
                    return (
                      <tr key={`${index}-${item.requirement}`} className="border-b border-border-subtle align-top last:border-b-0">
                        <td className="py-3 pr-3 font-medium">{item.requirement}</td>
                        <td className="py-3 pr-3">
                          <Badge tone={importanceTone[item.importance]}>
                            {importanceLabel[item.importance] ?? item.importance}
                          </Badge>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge tone={meta.tone}>
                            <meta.Icon className="size-3.5" aria-hidden />
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="py-3 text-sm leading-relaxed text-muted-foreground">
                          {item.explanation}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Skills, two columns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evidenced in your resume</CardTitle>
            <CardDescription>
              {checked
                ? `${verifiedCount} of ${analysis.matchedSkills.length} quotes were found word for word in your resume. Open one to see it.`
                : "Requirements your document supports. Open one to see the line it was read from."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analysis.matchedSkills.length ? (
              <div className="-mt-2">
                {analysis.matchedSkills.map((skill, index) => (
                  <Disclosure
                    key={`${index}-${skill.skill}`}
                    summary={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{skill.skill}</span>
                        <Badge tone={skill.strength === "strong" ? "positive" : "caution"}>
                          {skill.strength === "strong" ? "Demonstrated" : "Mentioned"}
                        </Badge>
                        {skill.verified === true ? (
                          <Badge tone="info" title="This quote was found in your resume.">
                            <ShieldCheck className="size-3.5" aria-hidden />
                            Verified quote
                          </Badge>
                        ) : skill.verified === false ? (
                          <Badge
                            tone="neutral"
                            title="This wording was not found in your resume. It may be a paraphrase; check it before relying on it."
                          >
                            <ShieldQuestion className="size-3.5" aria-hidden />
                            Paraphrase
                          </Badge>
                        ) : null}
                      </span>
                    }
                  >
                    <div className="flex gap-2 rounded-lg bg-surface-sunken p-3">
                      <Quote className="mt-0.5 size-3.5 shrink-0 opacity-60" aria-hidden />
                      <p className="italic">{skill.evidence}</p>
                    </div>
                    {skill.verified === false ? (
                      <p className="mt-2 text-xs">
                        Not found word for word in your resume. Treat it as the model&apos;s
                        summary, not a quote.
                      </p>
                    ) : null}
                  </Disclosure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                The model found nothing in your resume that clearly evidences this
                posting&apos;s requirements. That usually means the wrong file was
                uploaded, or the posting is for a different field.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asked for, not evident</CardTitle>
            <CardDescription>
              Gaps to develop or to evidence better — not things to claim.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analysis.missingSkills.length ? (
              <div className="-mt-2">
                {analysis.missingSkills.map((skill, index) => (
                  <Disclosure
                    key={`${index}-${skill.skill}`}
                    summary={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{skill.skill}</span>
                        <Badge tone={importanceTone[skill.importance]}>
                          {importanceLabel[skill.importance] ?? skill.importance}
                        </Badge>
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      <p>{skill.note}</p>
                      <p className="rounded-lg bg-surface-sunken p-3">
                        <span className="font-medium text-foreground">
                          Closest thing on your resume:{" "}
                        </span>
                        {skill.closestExperience}
                      </p>
                    </div>
                  </Disclosure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing in the posting was flagged as missing. Check the keyword table above
                for the finer-grained view.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {bulletSlot ?? <BulletRewritesCard rewrites={analysis.bulletRewrites} />}

      {/* Action plan */}
      {analysis.actionPlan.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Do these first</CardTitle>
            <CardDescription>
              Ordered by how much each one would change how this application reads.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol>
              {analysis.actionPlan.map((item, index) => (
                <li
                  key={`${index}-${item.step}`}
                  className="flex gap-4 border-t border-border-subtle py-4 first:border-t-0 first:pt-0"
                >
                  <span className="font-display text-sm font-semibold tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{item.step}</p>
                    <p className="text-sm text-muted-foreground">{item.why}</p>
                    <Badge tone="info">{effortLabel[item.effort] ?? item.effort}</Badge>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {/* Resume suggestions */}
      {analysis.resumeSuggestions.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Changes to the document</CardTitle>
            <CardDescription>Structure, emphasis and clarity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="-mt-2">
              {analysis.resumeSuggestions.map((suggestion, index) => (
                <Disclosure
                  key={`${index}-${suggestion.title}`}
                  summary={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={priorityTone[suggestion.priority]}>
                        {suggestion.priority} priority
                      </Badge>
                      <span className="font-medium">{suggestion.title}</span>
                      <span className="text-sm text-muted-foreground">{suggestion.area}</span>
                    </span>
                  }
                >
                  {suggestion.detail}
                </Disclosure>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Reviewer notes: the model's qualitative read, kept out of the score. */}
        {analysis.dimensions.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Reviewer notes</CardTitle>
              <CardDescription>
                The model&apos;s read on each area, in words. These are not part of the score.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {analysis.dimensions.map((dimension, index) => (
                <div key={`${index}-${dimension.name}`} className="space-y-1">
                  <p className="text-sm font-medium">{dimension.name}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{dimension.summary}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {analysis.interviewTopics.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Prepare for these</CardTitle>
              <CardDescription>
                Drawn from where your experience and the posting meet — and where they do not.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="-mt-2">
                {analysis.interviewTopics.map((topic, index) => (
                  <Disclosure
                    key={`${index}-${topic.topic}`}
                    summary={<span className="font-medium">{topic.topic}</span>}
                  >
                    <div className="space-y-2">
                      <p>{topic.why}</p>
                      {topic.questions.length ? (
                        <ul className="list-disc space-y-1 pl-5">
                          {topic.questions.map((question, qIndex) => (
                            <li key={`${qIndex}-${question}`}>{question}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </Disclosure>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Alert tone="info" title="Trying a different role?">
        <p>
          Paste another job description and run it again. Your resume stays loaded, so you can
          compare how the same document reads against several postings.
        </p>
        <Button size="sm" variant="outline" className={cn("mt-3")} onClick={onAnalyzeAnother}>
          <RotateCcw className="size-4" aria-hidden />
          Analyze another job description
        </Button>
      </Alert>
    </div>
  );
}
