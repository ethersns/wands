import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 font-marketing-mono text-[11px] uppercase tracking-[0.18em] text-mk-accent">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-mk-fg text-balance sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mk-muted text-pretty">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-mk-line bg-mk-surface/60", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-mk-line px-4 py-3">
          <h2 className="font-marketing-mono text-[11px] uppercase tracking-[0.16em] text-mk-muted">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** Overrides the value size, for a figure that is longer than a headline number. */
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-mk-line bg-mk-surface/60 px-4 py-3.5">
      <p className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-[-0.02em] text-mk-fg",
          valueClassName,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-mk-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-mk-line px-4 py-8">
      <p className="text-sm font-medium text-mk-fg">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-mk-muted text-pretty">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "warn" | "emerald";
}) {
  const tones = {
    neutral: "border-mk-line text-mk-muted",
    accent: "border-mk-accent/30 bg-mk-accent-soft text-mk-accent",
    warn: "border-mk-warn/30 bg-mk-warn/10 text-mk-warn",
    emerald: "border-mk-emerald/30 bg-mk-emerald/10 text-mk-emerald",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-marketing-mono text-[10px] uppercase tracking-[0.12em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ProvenanceNote({
  provenance,
  generatedAt,
  warnings,
  unreachable = false,
}: {
  provenance: string;
  /** `null` when the caller could not establish when the data was read. */
  generatedAt: string | null;
  warnings: string[];
  /** The engine could not be reached, as opposed to answering with nothing stored. */
  unreachable?: boolean;
}) {
  const partial = provenance === "partial";
  const live = provenance !== "unavailable" && !partial;
  const label = partial
    ? "Partial data"
    : live
      ? "Live data"
      : unreachable
        ? "Engine unreachable"
        : "Unavailable";
  const stamp = generatedAt === null ? null : new Date(generatedAt);
  // Callers concatenate warnings from several envelopes, so the same reason can
  // arrive twice. Dedupe before keying the list on the message itself.
  const unique = [...new Set(warnings)];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={live ? "emerald" : "warn"}>{label}</Badge>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {stamp === null || Number.isNaN(stamp.getTime())
            ? "unknown time"
            : `${stamp.toISOString().replace("T", " ").slice(0, 16)} UTC`}
        </span>
      </div>
      {unique.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {unique.slice(0, 3).map((warning) => (
            <li key={warning} className="text-xs leading-relaxed text-mk-muted">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/** The engine serialises decimals as strings; display code needs a number. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatShares(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "—";
  return parsed.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}
