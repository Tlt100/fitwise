"use client";

import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { useId } from "react";

const control =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-sm transition-colors duration-150 placeholder:text-muted-foreground";

export function TextField({
  label,
  hint,
  className,
  id,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={fieldId}
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className={cn(control, className)}
        {...props}
      />
      {hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  options,
  className,
  id,
  ...props
}: {
  label: string;
  options: { value: string; label: string }[];
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <select id={fieldId} className={cn(control, className)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A segmented radio group: one fieldset, visible legend, real radio inputs. */
export function SegmentedField<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center rounded-md border px-4 text-sm transition-colors duration-150",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              value === option.value
                ? "border-secondary bg-secondary/10 font-medium text-foreground"
                : "border-border bg-surface text-muted-foreground hover:bg-surface-sunken",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
