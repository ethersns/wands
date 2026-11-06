const sources = [
  "SEC EDGAR",
  "Form 4 insider transactions",
  "Form 13F holdings",
  "OHLCV market data",
  "Filing-level provenance",
  "Corporate actions",
];

export function SourceStrip() {
  return (
    <div className="border-y border-mk-line bg-mk-deep/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-8 sm:px-8">
        <p className="shrink-0 font-marketing-mono text-[9px] tracking-[0.18em] text-mk-dim uppercase">
          Built on primary sources
        </p>
        <ul className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2 sm:justify-between">
          {sources.map((source) => (
            <li
              key={source}
              className="flex items-center gap-2 font-marketing-mono text-[9.5px] tracking-[0.1em] text-mk-muted uppercase"
            >
              <span className="size-1 bg-mk-accent/60" aria-hidden />
              {source}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
