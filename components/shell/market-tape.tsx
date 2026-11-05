import type { DataProvenance, Quote } from "@/lib/api/contracts";
import { formatPercent, formatPrice, toneOf } from "@/lib/format";
import { cn } from "@/lib/utils";

function TapeItem({ quote }: { quote: Quote }) {
  const tone = toneOf(quote.change24hPct);

  return (
    <div className="flex shrink-0 items-center gap-2 border-r border-border/60 px-3 py-1.5">
      <span className="font-mono text-[11px] font-medium tracking-[0.02em] text-foreground/90">
        {quote.symbol}
      </span>
      <span className="font-mono text-[11px] tabular text-muted-foreground">
        {formatPrice(quote.price)}
      </span>
      <span
        className={cn(
          "font-mono text-[11px] tabular",
          tone === "profit"
            ? "text-profit"
            : tone === "loss"
              ? "text-loss"
              : "text-muted-foreground",
        )}
      >
        {formatPercent(quote.change24hPct, { signed: true })}
      </span>
      {quote.stale ? (
        <span
          className="rounded border border-border px-1 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
          title={`Quote is ${quote.ageSeconds}s old`}
        >
          stale
        </span>
      ) : null}
    </div>
  );
}

export function MarketTape({
  quotes,
  provenance,
}: {
  quotes: Quote[];
  provenance: DataProvenance;
}) {
  if (quotes.length === 0) return null;

  return (
    <div className="relative flex items-stretch border-b border-border bg-surface/50">
      <div className="z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-surface px-3">
        <span
          className={cn(
            "size-1.5 rounded-full",
            provenance === "live" ? "bg-profit animate-pulse-dot" : "bg-primary",
          )}
          aria-hidden
        />
        <span className="font-mono text-[9px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {provenance === "live" ? "Live" : "Demo"}
        </span>
      </div>

      <div className="hidden min-w-0 flex-1 overflow-hidden md:block">
        <div className="flex w-max animate-tape">
          {[0, 1].map((pass) => (
            <div key={pass} className="flex" aria-hidden={pass === 1}>
              {quotes.map((quote) => (
                <TapeItem key={`${pass}-${quote.symbol}`} quote={quote} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto md:hidden">
        <div className="flex w-max">
          {quotes.map((quote) => (
            <TapeItem key={quote.symbol} quote={quote} />
          ))}
        </div>
      </div>
    </div>
  );
}
