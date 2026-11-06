import { cn } from "@/lib/utils";

import { MiniChart } from "../mini-chart";
import { ProvenanceStrip } from "../provenance-strip";
import { TerminalFrame } from "../terminal-frame";

const rows = [
  {
    institution: "Meridian Capital",
    ticker: "NVDA",
    change: "Increased",
    delta: "+1.24M",
    weight: "3.1%",
    filed: "Nov 14",
  },
  {
    institution: "Northgate Asset Mgmt",
    ticker: "NVDA",
    change: "Increased",
    delta: "+860K",
    weight: "2.4%",
    filed: "Nov 13",
  },
  {
    institution: "Halcyon Partners",
    ticker: "ASML",
    change: "New",
    delta: "+1.90M",
    weight: "4.6%",
    filed: "Nov 14",
  },
  {
    institution: "Ardent Global",
    ticker: "NVDA",
    change: "Reduced",
    delta: "−410K",
    weight: "1.1%",
    filed: "Nov 12",
  },
  {
    institution: "Kestrel Investment",
    ticker: "COST",
    change: "Reduced",
    delta: "−220K",
    weight: "0.8%",
    filed: "Nov 11",
  },
];

const changeStyles: Record<string, string> = {
  Increased: "border-mk-accent/25 bg-mk-accent-soft text-mk-accent",
  New: "border-mk-accent/25 bg-mk-accent-soft text-mk-accent",
  Reduced: "border-mk-warn/25 bg-mk-warn/10 text-mk-warn",
};

const ownershipSeries = [41, 43, 44, 47, 46, 49, 52, 54];

export function InstitutionalRadarShowcase({
  className,
}: {
  className?: string;
}) {
  return (
    <TerminalFrame
      title="Intelligence / Institutional Radar"
      tabs={["Holdings", "Changes", "Consensus"]}
      activeTab="Changes"
      className={className}
      footer={
        <ProvenanceStrip
          items={[
            { label: "Source", value: "SEC Form 13F" },
            { label: "Period", value: "Q3 2026" },
            { label: "Filing lag", value: "45 days" },
          ]}
        />
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-mk-line px-3 py-2">
            {["Quarter Q3 2026", "Weighted by book", "Tracked: 128"].map(
              (filter) => (
                <span
                  key={filter}
                  className="rounded-md border border-mk-line bg-mk-deep/50 px-2 py-1 font-marketing-mono text-[10px] tracking-[0.06em] text-mk-muted"
                >
                  {filter}
                </span>
              ),
            )}
          </div>

          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Illustrative institutional position changes by portfolio weight
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                {["Institution", "Security", "Change", "Δ Shares", "% of book", "Filed"].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-marketing-mono text-[9.5px] font-medium tracking-[0.12em] text-mk-dim uppercase",
                        heading === "Δ Shares" && "hidden text-right md:table-cell",
                        heading === "% of book" && "text-right",
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
                  key={`${row.institution}-${row.ticker}`}
                  className="border-b border-mk-line/60 last:border-0"
                >
                  <td className="max-w-[9rem] truncate px-3 py-2.5 text-[11.5px] text-mk-fg">
                    {row.institution}
                  </td>
                  <td className="px-3 py-2.5 font-marketing-mono text-[11.5px] text-mk-muted">
                    {row.ticker}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex rounded border px-1.5 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.08em] uppercase",
                        changeStyles[row.change],
                      )}
                    >
                      {row.change}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right font-marketing-mono text-[11.5px] tabular-nums text-mk-muted md:table-cell">
                    {row.delta}
                  </td>
                  <td className="px-3 py-2.5 text-right font-marketing-mono text-[11.5px] tabular-nums text-mk-fg">
                    {row.weight}
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
          <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
            Consensus · NVDA
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-3xl leading-none font-semibold tracking-[-0.03em] text-mk-fg">
              7
            </span>
            <span className="pb-1 text-[10.5px] text-mk-muted">
              of 10 tracked holders increased
            </span>
          </div>

          <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full">
            <span className="h-full bg-mk-accent/70" style={{ width: "70%" }} />
            <span className="h-full bg-mk-warn/60" style={{ width: "20%" }} />
            <span className="h-full bg-mk-line-strong" style={{ width: "10%" }} />
          </div>
          <div className="mt-1.5 flex justify-between font-marketing-mono text-[9.5px] text-mk-dim">
            <span>7 increased</span>
            <span>2 reduced</span>
            <span>1 new</span>
          </div>

          <div className="mt-3 border-t border-mk-line pt-2.5">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Aggregate ownership
            </span>
            <div className="mt-1.5 h-16">
              <MiniChart
                series={ownershipSeries}
                height={64}
                label="Illustrative aggregate institutional ownership trend"
              />
            </div>
            <div className="mt-1 flex justify-between font-marketing-mono text-[9.5px] text-mk-dim">
              <span>Q4 24</span>
              <span>Q3 26</span>
            </div>
          </div>
        </aside>
      </div>
    </TerminalFrame>
  );
}
