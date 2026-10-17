import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "info" | "positive" | "caution" | "negative";

const config: Record<Tone, { className: string; Icon: typeof Info }> = {
  info: { className: "border-secondary/30 bg-secondary/5 text-foreground", Icon: Info },
  positive: {
    className: "border-positive/30 bg-positive-surface text-positive-foreground",
    Icon: CheckCircle2,
  },
  caution: {
    className: "border-caution/40 bg-caution-surface text-caution-foreground",
    Icon: AlertTriangle,
  },
  negative: {
    className: "border-negative/30 bg-negative-surface text-negative-foreground",
    Icon: XCircle,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const { className: toneClass, Icon } = config[tone];
  return (
    <div
      role={tone === "negative" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-4 text-sm", toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="[&_a]:underline">{children}</div> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}
