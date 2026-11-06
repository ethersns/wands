import type { ReactNode } from "react";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const TONES = {
  blocking: {
    icon: OctagonAlert,
    wrapper: "border-loss/30 bg-loss/[0.07]",
    iconClass: "text-loss",
    title: "text-foreground",
  },
  warning: {
    icon: AlertTriangle,
    wrapper: "border-warning/30 bg-warning/[0.07]",
    iconClass: "text-warning",
    title: "text-foreground",
  },
  info: {
    icon: Info,
    wrapper: "border-border bg-muted/40",
    iconClass: "text-muted-foreground",
    title: "text-foreground",
  },
} as const;

/**
 * A stated limitation. Amber is reserved for "this result is weaker than it
 * looks", which is the most common thing a research screen has to say.
 */
export function CoverageWarning({
  severity = "warning",
  title,
  children,
  className,
  action,
}: {
  severity?: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const tone = TONES[severity];
  const Icon = tone.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
        tone.wrapper,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[12px] font-medium", tone.title)}>{title}</p>
        {children ? (
          <div className="mt-0.5 text-[11px] leading-relaxed text-pretty text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Renders the engine's own caveat strings without paraphrasing them. */
export function CaveatList({
  caveats,
  className,
  severity = "info",
}: {
  caveats: string[];
  className?: string;
  severity?: keyof typeof TONES;
}) {
  if (caveats.length === 0) return null;

  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {caveats.map((caveat) => (
        <li key={caveat}>
          <CoverageWarning severity={severity} title={caveat} />
        </li>
      ))}
    </ul>
  );
}
