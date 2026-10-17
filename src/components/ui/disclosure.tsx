"use client";

import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * Progressive disclosure for a single finding. Collapsed by default so the
 * dashboard reads as a summary; the reasoning is one keystroke away.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={cn("border-b border-border-subtle last:border-b-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:text-secondary"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id={panelId} className="pb-4 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
