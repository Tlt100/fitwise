"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { groupChecks } from "@/lib/ats/checks";
import { ATS_CATEGORY_LABELS, type AtsCheck, type AtsReport, type AtsSeverity } from "@/lib/ats/types";
import { cn } from "@/lib/cn";
import { CircleCheck, CircleX, ShieldAlert, TriangleAlert } from "lucide-react";

/** Severity is always conveyed by icon + word, never by colour alone. */
const SEVERITY: Record<AtsSeverity, { label: string; tone: BadgeTone; Icon: typeof CircleCheck; iconClass: string }> = {
  fail: { label: "Problem", tone: "negative", Icon: CircleX, iconClass: "text-negative" },
  warn: { label: "Warning", tone: "caution", Icon: TriangleAlert, iconClass: "text-caution" },
  pass: { label: "Pass", tone: "positive", Icon: CircleCheck, iconClass: "text-positive" },
};

const RISK: Record<AtsReport["risk"], { label: string; tone: BadgeTone }> = {
  low: { label: "Low parse risk", tone: "positive" },
  medium: { label: "Medium parse risk", tone: "caution" },
  high: { label: "High parse risk", tone: "negative" },
};

const ORDER: Record<AtsSeverity, number> = { fail: 0, warn: 1, pass: 2 };

function count(checks: AtsCheck[], severity: AtsSeverity) {
  return checks.filter((c) => c.severity === severity).length;
}

function CheckRow({ check }: { check: AtsCheck }) {
  const { label, Icon, iconClass } = SEVERITY[check.severity];
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">
          <span className="sr-only">{label}: </span>
          {check.title}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">{check.detail}</p>
        {check.fix ? (
          <p className="text-sm leading-relaxed text-foreground">
            <span className="font-medium">How to fix: </span>
            {check.fix}
          </p>
        ) : null}
      </div>
      {check.severity !== "pass" ? (
        <span className="shrink-0 self-start text-xs font-medium text-muted-foreground" aria-hidden>
          {label}
        </span>
      ) : null}
    </li>
  );
}

function CountBadges({ checks }: { checks: AtsCheck[] }) {
  const fails = count(checks, "fail");
  const warns = count(checks, "warn");
  const passes = count(checks, "pass");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {fails ? <Badge tone="negative">{fails} {fails === 1 ? "problem" : "problems"}</Badge> : null}
      {warns ? <Badge tone="caution">{warns} {warns === 1 ? "warning" : "warnings"}</Badge> : null}
      {!fails && !warns ? <Badge tone="positive">All {passes} passed</Badge> : null}
    </span>
  );
}

export type AtsReportCardProps = {
  report: AtsReport;
  className?: string;
  /** Override the card title. */
  title?: string;
};

/**
 * Deterministic ATS parse-risk report: a score, then one collapsible group per
 * category. Groups with problems or warnings open by default.
 */
export function AtsReportCard({ report, className, title = "ATS parse check" }: AtsReportCardProps) {
  const groups = groupChecks(report);
  const risk = RISK[report.risk];
  const fails = count(report.checks, "fail");
  const warns = count(report.checks, "warn");
  const passes = count(report.checks, "pass");

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              How reliably applicant tracking systems can read this file. Runs locally, no AI involved.
            </CardDescription>
          </div>
          <div className="flex items-baseline gap-1" aria-label={`Score ${report.score} out of 100`}>
            <span className="font-display text-4xl font-semibold tabular-nums text-foreground">{report.score}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge tone={risk.tone}>{risk.label}</Badge>
          <span className="text-sm text-muted-foreground">
            {fails} {fails === 1 ? "problem" : "problems"} · {warns} {warns === 1 ? "warning" : "warnings"} · {passes} passed
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {report.suspectedInjection ? (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-negative/30 bg-negative-surface p-4 text-sm text-negative-foreground"
          >
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">Hidden text or AI instructions found. </span>
              Recruiters treat this as a red flag, and the analysis will ignore it. See Integrity below.
            </p>
          </div>
        ) : null}

        <div>
          {groups.map(({ category, checks }) => {
            const sorted = [...checks].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
            const hasIssues = checks.some((c) => c.severity !== "pass");
            return (
              <Disclosure
                key={category}
                defaultOpen={hasIssues}
                summary={
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{ATS_CATEGORY_LABELS[category]}</span>
                    <CountBadges checks={checks} />
                  </span>
                }
              >
                <ul className="divide-y divide-border-subtle">
                  {sorted.map((check) => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </ul>
              </Disclosure>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
