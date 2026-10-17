"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Analysis } from "@/lib/ai/analysis-schema";
import { cn } from "@/lib/cn";
import type { MatchResult, MatchStatus, TermLocation } from "@/lib/match/keywords";
import { normKey } from "@/lib/match/stem";
import { CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import { useMemo, useState } from "react";

export const keywordStatusMeta: Record<
  MatchStatus,
  { label: string; tone: BadgeTone; Icon: typeof CircleCheck; help: string }
> = {
  exact: {
    label: "Exact",
    tone: "positive",
    Icon: CircleCheck,
    help: "Your resume uses the posting's own term.",
  },
  variant: {
    label: "Variant",
    tone: "caution",
    Icon: CircleDashed,
    help: "Your resume uses a different spelling or form. A person will read it as a match; a literal keyword filter may not.",
  },
  missing: {
    label: "Missing",
    tone: "negative",
    Icon: CircleSlash,
    help: "Not found in your resume.",
  },
};

const locationLabel: Record<TermLocation, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  other: "Other",
};

type Filter = "all" | MatchStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing" },
  { id: "variant", label: "Variant" },
  { id: "exact", label: "Exact" },
];

/**
 * The deterministic keyword match as a filterable table. Status is always
 * shown as an icon plus a word, never by colour alone.
 */
export function KeywordTable({
  match,
  guidance,
}: {
  match: MatchResult;
  /** The model's keyword guidance, shown for terms whose name matches. */
  guidance?: Analysis["keywords"];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [requiredOnly, setRequiredOnly] = useState(false);

  const guidanceByTerm = useMemo(
    () => new Map((guidance ?? []).map((g) => [normKey(g.keyword), g.guidance])),
    [guidance],
  );

  const counts = {
    all: match.terms.length,
    exact: match.coverage.exactCount,
    variant: match.coverage.variantCount,
    missing: match.coverage.missingCount,
  };

  const rows = match.terms.filter(
    (t) => (filter === "all" || t.status === filter) && (!requiredOnly || t.required),
  );

  if (!match.terms.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No recognisable skills, tools or credentials were found in this posting, so there is
        nothing to match. That usually means the posting is very short or mostly about the
        company.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter keywords by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className="tabular-nums">({counts[f.id]})</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={requiredOnly}
            onChange={(e) => setRequiredOnly(e.target.checked)}
            className="size-4 accent-current"
          />
          Required only
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">
            Terms from the posting and where your resume shows them
          </caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-2 pr-3 font-medium">Term</th>
              <th scope="col" className="py-2 pr-3 font-medium">Status</th>
              <th scope="col" className="py-2 pr-3 font-medium">Posting</th>
              <th scope="col" className="py-2 pr-3 font-medium">Found in</th>
              <th scope="col" className="py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, index) => {
              const meta = keywordStatusMeta[t.status];
              const tip = guidanceByTerm.get(normKey(t.term));
              return (
                <tr key={`${index}-${t.term}`} className="border-b border-border-subtle last:border-b-0 align-top">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{t.term}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.category}</span>
                    {t.status === "missing" && tip ? (
                      <p className="mt-1 text-xs text-muted-foreground">{tip}</p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={meta.tone} title={meta.help}>
                      <meta.Icon className="size-3.5" aria-hidden />
                      {meta.label}
                    </Badge>
                    {t.status === "variant" && t.matchedForms.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        You wrote “{t.matchedForms.join("”, “")}”
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    {t.required ? (
                      <span className="font-semibold text-foreground">Required</span>
                    ) : (
                      <span className="text-muted-foreground">Preferred</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                    {t.locations.length ? t.locations.map((l) => locationLabel[l]).join(", ") : "—"}
                  </td>
                  <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {t.weight.toFixed(1)}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="py-4 text-sm text-muted-foreground">
                  No terms match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Counted in code, not by the model. Weight reflects where the posting mentions a term
        (requirements count most, nice-to-haves least) and how often; soft skills count half.
        {match.jdStructure === "unstructured"
          ? " This posting has no requirements section, so every hard skill is treated as required."
          : null}{" "}
        Adding a term you cannot back up in an interview costs more than it gains.
      </p>
    </div>
  );
}
