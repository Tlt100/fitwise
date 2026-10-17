"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  SCORE_LABELS,
  aggregateMissingKeywords,
  bestIndex,
  presentScoreKeys,
} from "@/lib/history/compare";
import type { HistoryEntry } from "@/lib/history/store";

export interface ComparePanelProps {
  /** 2 to 5 entries; fewer renders a prompt, more are truncated to 5. */
  entries: HistoryEntry[];
}

function scoreTone(value: number): string {
  if (value >= 75) return "text-positive-foreground";
  if (value >= 50) return "text-caution-foreground";
  return "text-negative-foreground";
}

export function ComparePanel({ entries: all }: ComparePanelProps) {
  const entries = all.slice(0, 5);
  const keys = presentScoreKeys(entries);
  const common = aggregateMissingKeywords(entries, 0.5);
  const resumes = new Set(entries.map((e) => e.resumeHash)).size;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare postings</CardTitle>
        <CardDescription>
          How the same evidence scores against each role, and which skills keep coming up as gaps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {entries.length < 2 ? (
          <p className="text-sm text-muted-foreground">Select at least two saved analyses to compare.</p>
        ) : (
          <>
            {resumes > 1 ? (
              <p className="rounded-md bg-caution-surface p-3 text-sm text-caution-foreground">
                These analyses were run against {resumes} different resumes, so score differences may
                reflect the resume rather than the posting.
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <caption className="sr-only">Score components for each selected posting</caption>
                <thead className="bg-surface-sunken text-left">
                  <tr>
                    <th scope="col" className="p-3 font-medium">
                      Posting
                    </th>
                    {keys.map((key) => (
                      <th key={key} scope="col" className="p-3 text-right font-medium">
                        {SCORE_LABELS[key]}
                      </th>
                    ))}
                    <th scope="col" className="p-3 text-right font-medium">
                      Gaps
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, row) => (
                    <tr key={entry.id} className="border-t border-border-subtle">
                      <th scope="row" className="p-3 text-left font-normal">
                        <span className="block font-medium">{entry.roleTitle}</span>
                        <span className="text-xs text-muted-foreground">
                          {entry.company ? `${entry.company} · ` : ""}
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </span>
                      </th>
                      {keys.map((key) => {
                        const value = entry.scores[key];
                        const best = bestIndex(entries, key) === row;
                        return (
                          <td key={key} className="p-3 text-right tabular-nums">
                            {typeof value === "number" ? (
                              <span className={cn("font-semibold", scoreTone(value))}>
                                {value}
                                {best ? <span className="sr-only"> (highest)</span> : null}
                                {best ? (
                                  <span aria-hidden className="ml-1 text-xs font-normal text-muted-foreground">
                                    top
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                <span aria-hidden>—</span>
                                <span className="sr-only">not available</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-3 text-right tabular-nums">{entry.missingKeywords.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section aria-labelledby="compare-common-gaps" className="space-y-3">
              <h3 id="compare-common-gaps" className="font-display text-base font-semibold">
                Skills missing in most of these postings
              </h3>
              {common.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No single gap shows up in at least half of the selected postings.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {common.slice(0, 20).map((agg) => (
                    <li key={agg.keyword}>
                      <Badge
                        tone={agg.share >= 0.75 ? "negative" : "caution"}
                        title={agg.roles.join(", ")}
                      >
                        {agg.keyword}
                        <span className="tabular-nums opacity-80">
                          {agg.count}/{entries.length}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                A gap that recurs across roles you want is usually worth learning or evidencing before
                tailoring each application.
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
