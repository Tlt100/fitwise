import { Slot } from "@/components/ui/slot";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-secondary text-on-secondary hover:bg-secondary-hover",
  outline:
    "border border-border bg-surface text-foreground hover:bg-surface-sunken",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-negative text-white hover:opacity-90",
};

// Every size clears the 44px touch target at `md` and above; `sm` is reserved
// for controls that sit inside an already-large hit area.
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-6 text-[0.95rem] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  /**
   * Work is in progress: clicks are ignored and assistive tech hears "busy",
   * but the button keeps full contrast (unlike `disabled`) so its label stays
   * readable.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  type = "button",
  loading = false,
  onClick,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type })}
      aria-busy={loading || undefined}
      aria-disabled={loading || props["aria-disabled"]}
      onClick={loading ? undefined : onClick}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium",
        "transition-colors duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-50",
        loading && "pointer-events-none cursor-progress",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
