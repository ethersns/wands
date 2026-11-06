import { cn } from "@/lib/utils";

export function ScoreBar({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-mk-muted">{label}</span>
        <span className="font-marketing-mono text-[11px] tabular-nums text-mk-fg">
          {value}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-mk-raised">
        <div
          className="h-full rounded-full bg-mk-accent/70"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "loss";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2.5">
      <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-marketing-mono text-[15px] tabular-nums",
          tone === "accent" && "text-mk-accent",
          tone === "loss" && "text-mk-warn",
          tone === "default" && "text-mk-fg",
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-[10px] text-mk-dim">{hint}</span> : null}
    </div>
  );
}
