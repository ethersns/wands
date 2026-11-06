import { cn } from "@/lib/utils";
import { formatScore, scoreBand, scoreTone } from "@/lib/intelligence/presentation";
import { toneText } from "@/lib/status";

const barTone: Record<string, string> = {
  profit: "bg-profit",
  primary: "bg-primary",
  muted: "bg-muted-foreground/60",
};

/**
 * A bounded 0-100 research ranking.
 *
 * The label is part of the component, not the caller's responsibility: a bare
 * number in a financial table reads as a probability, and this is not one.
 */
export function ResearchScore({
  score,
  className,
  showLabel = false,
}: {
  score: number | null;
  className?: string;
  showLabel?: boolean;
}) {
  const tone = scoreTone(score);

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      title={
        score === null
          ? "No research score: the engine did not have enough evidence to rank this signal."
          : `Research score ${formatScore(score)} of 100 (${scoreBand(score)}). A ranking of evidence, not a probability of profit.`
      }
    >
      {showLabel ? (
        <span className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
          Research score
        </span>
      ) : null}
      <span
        className={cn(
          "font-mono text-[12px] tabular leading-none",
          score === null ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {formatScore(score)}
      </span>
      <span
        className="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-muted"
        aria-hidden
      >
        <span
          className={cn("block h-full rounded-full", barTone[tone])}
          style={{ width: `${score === null ? 0 : Math.max(2, Math.min(100, score))}%` }}
        />
      </span>
      <span className="sr-only">
        {score === null
          ? "No research score available"
          : `Research score ${formatScore(score)} of 100, ${scoreBand(score).toLowerCase()}. A ranking, not a probability.`}
      </span>
    </span>
  );
}

/** A larger score readout for a detail panel. */
export function ResearchScoreBlock({
  score,
  explanation,
  className,
}: {
  score: number | null;
  explanation?: string;
  className?: string;
}) {
  const tone = scoreTone(score);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[28px] leading-none tabular tracking-[-0.02em]",
            score === null ? "text-muted-foreground" : toneText[tone],
          )}
        >
          {formatScore(score)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          / 100 · {scoreBand(score)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", barTone[tone])}
          style={{ width: `${score === null ? 0 : Math.max(1, Math.min(100, score))}%` }}
        />
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Research score — a bounded ranking of the evidence behind this signal. It
        is not a probability of profit and not a forecast.
      </p>
      {explanation ? (
        <p className="text-[11px] leading-relaxed text-pretty text-foreground/80">
          {explanation}
        </p>
      ) : null}
    </div>
  );
}
