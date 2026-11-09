import Link from "next/link";

import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "monetary_policy", label: "Monetary policy" },
  { value: "insider_disclosure", label: "Insider" },
  { value: "institutional_disclosure", label: "Institutional" },
] as const;

const WINDOWS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
] as const;

function buildHref(next: { category?: string; symbol?: string; window?: string }): string {
  const params = new URLSearchParams();
  if (next.category) params.set("category", next.category);
  if (next.symbol) params.set("symbol", next.symbol);
  if (next.window) params.set("window", next.window);
  const query = params.toString();
  return `/app/catalysts${query ? `?${query}` : ""}`;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-2.5 py-1 font-marketing-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
        active
          ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
          : "border-mk-line text-mk-muted hover:border-mk-line hover:text-mk-fg",
      )}
    >
      {children}
    </Link>
  );
}

export function CatalystFilters({
  category,
  symbol,
  windowValue,
}: {
  category: string;
  symbol: string;
  windowValue: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-mk-line bg-mk-surface/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
          Category
        </span>
        {CATEGORIES.map((option) => (
          <Chip
            key={option.value || "all"}
            href={buildHref({ category: option.value, symbol, window: windowValue })}
            active={category === option.value}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
          Window
        </span>
        {WINDOWS.map((option) => (
          <Chip
            key={option.value}
            href={buildHref({ category, symbol, window: option.value })}
            active={windowValue === option.value}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <form action="/app/catalysts" method="get" className="flex flex-wrap items-center gap-2">
        {category ? <input type="hidden" name="category" value={category} /> : null}
        {windowValue ? <input type="hidden" name="window" value={windowValue} /> : null}
        <label
          htmlFor="catalyst-symbol"
          className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim"
        >
          Symbol
        </label>
        <input
          id="catalyst-symbol"
          name="symbol"
          defaultValue={symbol}
          placeholder="AAPL"
          autoComplete="off"
          spellCheck={false}
          className="w-24 rounded-md border border-mk-line bg-mk-deep/60 px-2 py-1 font-marketing-mono text-[11px] uppercase tracking-[0.08em] text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/50 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-mk-line px-2.5 py-1 font-marketing-mono text-[10px] uppercase tracking-[0.1em] text-mk-muted transition-colors hover:text-mk-fg"
        >
          Apply
        </button>
        {symbol ? (
          <Link
            href={buildHref({ category, window: windowValue })}
            className="text-[11px] text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Clear symbol
          </Link>
        ) : null}
      </form>
    </div>
  );
}
