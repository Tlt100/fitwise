"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BulletRewrite } from "@/lib/ai/analysis-schema";
import { TriangleAlert } from "lucide-react";

/**
 * Suggested rewrites of bullets that exist in the resume. Rewrites whose
 * original could not be found were already removed server-side; any rewrite
 * that adds figures the original lacks is flagged here, so the candidate does
 * not paste in a number they cannot stand behind.
 */
export function BulletRewritesCard({ rewrites }: { rewrites: BulletRewrite[] }) {
  if (!rewrites.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested rewrites</CardTitle>
        <CardDescription>
          Each original was checked against your resume. Rewrites only reorganise what is
          already there.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rewrites.map((rewrite, index) => (
          <div key={`${index}-${rewrite.original}`} className="space-y-2 rounded-lg border border-border-subtle p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{rewrite.section}</span>
              {rewrite.addsUnverifiedNumbers ? (
                <Badge
                  tone="caution"
                  title="The rewrite contains figures that are not in your original bullet."
                >
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Adds numbers: {rewrite.unverifiedNumbers?.join(", ")}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Original: </span>
              {rewrite.original}
            </p>
            <p className="text-sm">
              <span className="font-medium">Suggested: </span>
              {rewrite.suggested}
            </p>
            {rewrite.addsUnverifiedNumbers ? (
              <p className="text-xs text-caution-foreground">
                Only keep these figures if they are true and you can explain them. Otherwise use
                your real numbers or leave them out.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">{rewrite.rationale}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
