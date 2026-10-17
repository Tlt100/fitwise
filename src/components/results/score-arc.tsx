"use client";

import { cn } from "@/lib/cn";
import { useEffect, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the user has asked the OS for less motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCED_MOTION).matches : false),
    () => false,
  );
}

/** Evidence colour for a 0-100 score, matching the green / amber / red scale. */
export function scoreTone(score: number | null): "positive" | "caution" | "negative" | "neutral" {
  if (score === null) return "neutral";
  return score >= 75 ? "positive" : score >= 50 ? "caution" : "negative";
}

const textTone = {
  positive: "text-positive",
  caution: "text-caution",
  negative: "text-negative",
  neutral: "text-muted-foreground",
} as const;

const bgTone = {
  positive: "bg-positive",
  caution: "bg-caution",
  negative: "bg-negative",
  neutral: "bg-muted-foreground",
} as const;

/**
 * A single number deserves a single mark. The arc exists to make the score
 * readable at a glance and to carry the same evidence colours used elsewhere;
 * it is not decoration, and the number and its label are always present as
 * text, so colour never carries the meaning alone.
 */
export function ScoreArc({
  score,
  label,
  size = 180,
}: {
  score: number | null;
  label: string;
  size?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (reduced) return;
    // One frame of delay so the stroke animates from empty on mount.
    const frame = requestAnimationFrame(() => setAnimated(score ?? 0));
    return () => cancelAnimationFrame(frame);
  }, [score, reduced]);

  const shown = reduced ? (score ?? 0) : animated;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * radius; // semicircle
  const offset = circumference * (1 - Math.min(Math.max(shown, 0), 100) / 100);
  const tone = scoreTone(score);

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size / 2 + 8}
        viewBox={`0 0 ${size} ${size / 2 + 8}`}
        role="img"
        aria-label={
          score === null
            ? `Match score not available. ${label}.`
            : `Match score: ${score} out of 100. ${label}.`
        }
      >
        <path
          d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke="currentColor"
          className={cn(
            textTone[tone],
            "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
          )}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="-mt-10 flex flex-col items-center" aria-hidden>
        <span className="font-display text-4xl font-extrabold tabular-nums">
          {score ?? "–"}
          <span className="text-lg font-semibold text-muted-foreground">/100</span>
        </span>
        <span className={cn("font-display text-sm font-semibold", textTone[tone])}>{label}</span>
      </div>
    </div>
  );
}

/** Horizontal bar for one score component. The number is always shown as text. */
export function ScoreBar({
  score,
  name,
  suffix,
}: {
  score: number | null;
  name: string;
  /** Extra text after the number, e.g. "weight 40%". */
  suffix?: string;
}) {
  const tone = scoreTone(score);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums text-muted-foreground">
          {score === null ? "Not measured" : score}
          {suffix ? <span className="ml-2 text-xs">{suffix}</span> : null}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={score === null ? `${name}: not measured` : `${name}: ${score} out of 100`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none",
            bgTone[tone],
          )}
          style={{ width: `${score === null ? 0 : Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}
