import { cn } from "@/lib/utils";

import { ProvenanceStrip } from "../provenance-strip";
import { ScoreBar } from "../score-bar";
import { TerminalFrame } from "../terminal-frame";

const rows = [
  {
    ticker: "NVDA",
    company: "NVIDIA Corp",
    insider: "R. Alvarez",
    role: "Director",
    type: "Buy",
    value: "$2.41M",
    score: 92,
    filed: "2d",
  },
  {
    ticker: "MSFT",
    company: "Microsoft Corp",
    insider: "J. Whitfield",
    role: "CFO",
    type: "Buy",
    value: "$1.08M",
    score: 87,
    filed: "3d",
  },
  {
    ticker: "ASML",
    company: "ASML Holding",
    insider: "P. Vermeer",
    role: "Director",
    type: "Buy",
    value: "$640K",
    score: 81,
    filed: "4d",
  },
  {
    ticker: "COST",
    company: "Costco Wholesale",
    insider: "D. Okafor",
    role: "EVP",
    type: "Buy",
    value: "$412K",
    score: 74,
    filed: "6d",
  },
  {
    ticker: "TSM",
    company: "Taiwan Semi.",
    insider: "L. Chen",
    role: "Director",
    type: "Sell",
    value: "$3.90M",
    score: 68,
    filed: "7d",
  },
];

const filters = ["Window 30d", "Min score 60", "Open-market only", "All sectors"];

export function InsiderRadarShowcase({ className }: { className?: string }) {
  return (
    <TerminalFrame
      title="Intelligence / Insider Radar"
      tabs={["Signals", "Insiders", "Coverage"]}
      activeTab="Signals"
      className={className}
      glow
      footer={
        <ProvenanceStrip
          items={[
            { label: "Source", value: "SEC Form 4" },
            { label: "Ingested", value: "2026-11-04 09:12 UTC" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-mk-line px-3 py-2">
            {filters.map((filter) => (
              <span
                key={filter}
                className="rounded-md border border-mk-line bg-mk-deep/50 px-2 py-1 font-marketing-mono text-[10px] tracking-[0.06em] text-mk-muted"
              >
                {filter}
              </span>
            ))}
          </div>

          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Illustrative insider transaction signals with conviction scores
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                {["Security", "Insider", "Type", "Value", "Score", "Filed"].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-marketing-mono text-[9.5px] font-medium tracking-[0.12em] text-mk-dim uppercase",
                        heading === "Insider" && "hidden sm:table-cell",
                        heading === "Value" && "hidden text-right md:table-cell",
                        heading === "Score" && "text-right",
                        heading === "Filed" && "hidden text-right sm:table-cell",
                      )}
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.ticker}-${row.insider}`}
                  className="border-b border-mk-line/60 last:border-0"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-marketing-mono text-[12px] text-mk-fg">
                        {row.ticker}
                      </span>
                      <span className="truncate text-[10.5px] text-mk-dim">
                        {row.company}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <div className="flex flex-col">
                      <span className="text-[11.5px] text-mk-fg">
                        {row.insider}
                      </span>
                      <span className="text-[10.5px] text-mk-dim">
                        {row.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex rounded border px-1.5 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.08em] uppercase",
                        row.type === "Buy"
                          ? "border-mk-accent/25 bg-mk-accent-soft text-mk-accent"
                          : "border-mk-warn/25 bg-mk-warn/10 text-mk-warn",
                      )}
                    >
                      {row.type}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right font-marketing-mono text-[11.5px] tabular-nums text-mk-muted md:table-cell">
                    {row.value}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-mk-raised sm:block">
                        <span
                          className="block h-full rounded-full bg-mk-accent/70"
                          style={{ width: `${row.score}%` }}
                        />
                      </span>
                      <span className="font-marketing-mono text-[11.5px] tabular-nums text-mk-fg">
                        {row.score}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right font-marketing-mono text-[10.5px] text-mk-dim sm:table-cell">
                    {row.filed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="border-t border-mk-line p-3 lg:border-t-0 lg:border-l">
          <div className="flex items-baseline justify-between">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Signal detail
            </span>
            <span className="font-marketing-mono text-[10px] text-mk-muted">
              NVDA
            </span>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="font-display text-3xl leading-none font-semibold tracking-[-0.03em] text-mk-accent">
              92
            </span>
            <span className="pb-1 font-marketing-mono text-[10px] text-mk-dim">
              / 100 conviction
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-2.5">
            <ScoreBar label="Cluster activity" value={96} />
            <ScoreBar label="Role seniority" value={88} />
            <ScoreBar label="Size vs. history" value={91} />
            <ScoreBar label="Filing recency" value={84} />
          </div>

          <div className="mt-3 border-t border-mk-line pt-2.5">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Evidence
            </span>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {[
                "Form 4 · 0001045810-26-000142",
                "Transaction 2026-11-03",
                "3 insiders · same window",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-1.5 text-[10.5px] leading-snug text-mk-muted"
                >
                  <span
                    className="mt-1 size-1 shrink-0 rounded-full bg-mk-accent/60"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </TerminalFrame>
  );
}
