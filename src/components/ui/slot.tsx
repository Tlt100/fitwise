import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal `asChild` support: merges props onto a single child element instead
 * of pulling in Radix for this one behaviour.
 */
export function Slot({
  children,
  className,
  ...props
}: { children?: ReactNode; className?: string } & Record<string, unknown>) {
  const child = Children.only(children);
  if (!isValidElement<{ className?: string }>(child)) return null;
  return cloneElement(child, {
    ...props,
    className: cn(className, child.props.className),
  } as never);
}
