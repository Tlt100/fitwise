"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { weakest, type BulletLint, type BulletLintReport } from "@/lib/lint/bullets";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useState } from "react";

const SCORE: Array<{ label: string; tone: BadgeTone; Icon: typeof CircleCheck; iconClass: string }> = [
  { label: "Weak", tone: "negative", Icon: CircleX, iconClass: "text-negative" },
  { label: "Needs work", tone: "negative", Icon: CircleX, iconClass: "text-negative" },
  { label: "Almost there", tone: "caution", Icon: TriangleAlert, iconClass: "text-caution" },
  { label: "Strong", tone: "positive", Icon: CircleCheck, iconClass: "text-positive" },
];

function BulletRow({ bullet }: { bullet: BulletLint }) {
  const meta = SCORE[bullet.score] ?? SCORE[0];
  const { Icon } = meta;
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", meta.iconClass)} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm leading-relaxed text-foreground">{bullet.text}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={meta.tone}>
              {meta.label} · {bullet.score}/3
            </Badge>
            {bullet.flags.map((flag) => (
              <Badge key={flag.id} tone="neutral" title={flag.advice}>
                {flag.label}
              </Badge>
            ))}
          </div>
          {bullet.flags.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {bullet.flags.map((flag) => (
                <li key={flag.id}>
                  <span className="font-medium text-foreground">{flag.label}: </span>
                  {flag.advice}
                </li>
              ))}
            </ul>
          ) : null}
          {bullet.suggestion ? (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm leading-relaxed text-foreground">
              {bullet.suggestion}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export type BulletLintCardProps = {
  report: BulletLintReport;
  className?: string;
  /** How many bullets to show before "Show all". Defaults to 5. */
  initialCount?: number;
  title?: string;
};

/**
 * Bullet-by-bullet feedback, weakest first. Suggestions use [placeholders]
 * for results: the user supplies their own numbers.
 */
export function BulletLintCard({ report, className, initialCount = 5, title = "Bullet check" }: BulletLintCardProps) {
  const [showAll, setShowAll] = useState(false);
  const needsWork = weakest(report, report.bullets.length);
  const strong = report.bullets.filter((b) => !needsWork.includes(b));
  const ordered = [...needsWork, ...strong];
  const visible = showAll ? ordered : ordered.slice(0, initialCount);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{report.summary}</CardDescription>
        {report.total > 0 ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge tone={report.withMetric / report.total >= 0.6 ? "positive" : "caution"}>
              {report.withMetric}/{report.total} with a measurable result
            </Badge>
            <Badge tone={report.withStrongVerb / report.total >= 0.8 ? "positive" : "caution"}>
              {report.withStrongVerb}/{report.total} start with an action verb
            </Badge>
            <Badge tone="neutral">Average {report.averageScore}/3</Badge>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Aim for: <span className="font-medium text-foreground">{report.formula}</span>. Use numbers you can
          back up in an interview; if you do not have one, describe the scale instead.
        </p>

        {report.total === 0 ? null : (
          <>
            <ul className="divide-y divide-border-subtle" aria-label="Bullets, weakest first">
              {visible.map((bullet) => (
                <BulletRow key={bullet.index} bullet={bullet} />
              ))}
            </ul>
            {ordered.length > initialCount ? (
              <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : `Show all ${ordered.length} bullets`}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
