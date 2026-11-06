import { cn } from "@/lib/utils";
import { signalCategoryLabel } from "@/lib/intelligence/presentation";

/**
 * A signal category. Deliberately neutral: colour in this terminal means
 * direction (a purchase or a sale), never category, so a category chip must not
 * borrow the profit or loss palette.
 */
export function SignalBadge({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-[0.02em] whitespace-nowrap text-foreground",
        className,
      )}
    >
      {signalCategoryLabel(category)}
    </span>
  );
}

/** The direction a transaction implies. `null` renders nothing. */
export function DirectionBadge({
  direction,
  className,
}: {
  direction: "buy" | "sell" | null;
  className?: string;
}) {
  if (!direction) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.06em] uppercase",
        direction === "buy"
          ? "border-profit/30 bg-profit/10 text-profit"
          : "border-loss/30 bg-loss/10 text-loss",
        className,
      )}
    >
      {direction === "buy" ? "Buy" : "Sell"}
    </span>
  );
}
