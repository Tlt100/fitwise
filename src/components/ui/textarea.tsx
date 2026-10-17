"use client";

import { cn } from "@/lib/cn";
import type { TextareaHTMLAttributes } from "react";
import { useId } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Renders a live character count; pairs with maxLength for the ceiling. */
  counter?: { value: number; min?: number; max?: number };
}

export function Textarea({
  label,
  hint,
  error,
  counter,
  className,
  id,
  ...props
}: TextareaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const over = counter?.max !== undefined && counter.value > counter.max;
  const under = counter?.min !== undefined && counter.value > 0 && counter.value < counter.min;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* Visible label, not a placeholder — placeholders vanish the moment
            someone starts typing, which is exactly when the label is needed. */}
        <label htmlFor={fieldId} className="text-sm font-medium">
          {label}
        </label>
        {counter ? (
          <span
            aria-live="polite"
            className={cn(
              "text-xs tabular-nums",
              over || under ? "text-negative" : "text-muted-foreground",
            )}
          >
            {counter.value.toLocaleString()}
            {counter.max ? ` / ${counter.max.toLocaleString()}` : ""} characters
            {under ? ` · ${counter.min! - counter.value} more needed` : ""}
          </span>
        ) : null}
      </div>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && hintId, error && errorId) || undefined}
        className={cn(
          "min-h-56 w-full resize-y rounded-lg border bg-surface px-4 py-3 text-sm leading-relaxed",
          "transition-colors duration-150 placeholder:text-muted-foreground",
          error ? "border-negative" : "border-border",
          className,
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        /* Error sits next to the field it belongs to, not in a banner at the top. */
        <p id={errorId} role="alert" className="text-xs font-medium text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
