import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "positive" | "caution" | "negative" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-positive-surface text-positive-foreground",
  caution: "bg-caution-surface text-caution-foreground",
  negative: "bg-negative-surface text-negative-foreground",
  info: "bg-secondary/10 text-secondary",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
