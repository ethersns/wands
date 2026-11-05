import { CircleCheck, FlaskConical, CircleSlash } from "lucide-react";

import type { DataProvenance } from "@/lib/api/contracts";
import { cn } from "@/lib/utils";

const config: Record<
  DataProvenance,
  { label: string; icon: typeof CircleCheck; className: string; title: string }
> = {
  live: {
    label: "Live",
    icon: CircleCheck,
    className: "border-profit/30 bg-profit/10 text-profit",
    title: "Sourced from the connected trading engine.",
  },
  demo: {
    label: "Demo",
    icon: FlaskConical,
    className: "border-primary/30 bg-primary/10 text-primary",
    title:
      "Demonstration data. Not a real account balance and not a real trade.",
  },
  unavailable: {
    label: "Unavailable",
    icon: CircleSlash,
    className: "border-border bg-muted text-muted-foreground",
    title: "The engine did not return this data.",
  },
};

export function ProvenanceBadge({
  provenance,
  className,
  showLabel = true,
}: {
  provenance: DataProvenance;
  className?: string;
  showLabel?: boolean;
}) {
  const { label, icon: Icon, className: tone, title } = config[provenance];

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase",
        tone,
        className,
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {showLabel ? label : <span className="sr-only">{label}</span>}
    </span>
  );
}
