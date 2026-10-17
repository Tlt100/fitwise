import { cn } from "@/lib/cn";

/**
 * Two overlapping rings, one for the resume and one for the posting, with the
 * overlap filled in: the fit is the part the two have in common.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn("size-7 shrink-0", className)}
      fill="none"
    >
      {/* Lens where the two circles (r 6, centres 9 and 15) intersect. */}
      <path d="M12 6.8a6 6 0 0 1 0 10.4a6 6 0 0 1 0-10.4Z" className="fill-secondary" />
      <circle cx="9" cy="12" r="6" className="stroke-primary" strokeWidth="2" />
      <circle cx="15" cy="12" r="6" className="stroke-primary" strokeWidth="2" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-tight">Fitwise</span>
    </span>
  );
}
