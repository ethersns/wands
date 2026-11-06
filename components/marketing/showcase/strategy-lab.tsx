import { MiniChart } from "../mini-chart";
import { MetricTile } from "../score-bar";
import { ProvenanceStrip } from "../provenance-strip";
import { TerminalFrame } from "../terminal-frame";

const equityCurve = [
  100, 101.2, 100.4, 102.1, 103.8, 103.1, 105.4, 106.9, 106.2, 108.5, 110.1,
  109.4, 111.8, 113.2, 112.6, 115.1, 116.4, 115.8, 118.2, 119.6, 118.9, 121.4,
  122.8, 122.1, 124.6, 126.2, 125.4, 128.1, 129.7, 128.9, 131.4, 133.1, 132.4,
  135.2, 136.8, 136.1, 138.9, 140.6, 139.8, 142.4,
];

const validation = [
  { label: "In-sample", value: "2019-01 → 2023-12" },
  { label: "Out-of-sample", value: "2024-01 → 2026-09" },
  { label: "Costs", value: "6 bps + 4 bps slippage" },
  { label: "Universe", value: "480 large caps" },
];

export function StrategyLabShowcase({ className }: { className?: string }) {
  return (
    <TerminalFrame
      title="Strategy Lab / Run 4,182"
      tabs={["Parameters", "Results", "Validation"]}
      activeTab="Results"
      className={className}
      footer={
        <ProvenanceStrip
          items={[
            { label: "Run", value: "4,182" },
            { label: "Data window", value: "2019-01 → 2026-09" },
            { label: "Reproducible", value: "Yes" },
          ]}
        />
      }
    >
      <div className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[12.5px] font-medium text-mk-fg">
              Post-earnings drift · Large cap
            </span>
            <span className="font-marketing-mono text-[10px] text-mk-dim">
              Long only · 20-day hold · Vol-scaled sizing
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-mk-accent/25 bg-mk-accent-soft px-2 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.1em] text-mk-accent uppercase">
            <span className="size-1 rounded-full bg-mk-accent" aria-hidden />
            Out-of-sample passed
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricTile label="CAGR" value="18.4%" tone="accent" />
          <MetricTile label="Sharpe" value="1.42" />
          <MetricTile label="Max drawdown" value="−11.8%" tone="loss" />
          <MetricTile label="Win rate" value="57.3%" />
        </div>

        <div className="mt-3 rounded-lg border border-mk-line bg-mk-deep/40 p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Equity curve · indexed
            </span>
            <div className="flex items-center gap-3 font-marketing-mono text-[9px] text-mk-dim">
              <span className="flex items-center gap-1">
                <span className="h-px w-3 bg-mk-fg/45" aria-hidden />
                In-sample
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="h-px w-3 border-t border-dashed border-mk-accent"
                  aria-hidden
                />
                Out-of-sample
              </span>
            </div>
          </div>
          <div className="h-28 sm:h-32">
            <MiniChart
              series={equityCurve}
              splitIndex={28}
              height={128}
              label="Illustrative equity curve with out-of-sample split"
            />
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-mk-line pt-2.5 sm:grid-cols-4">
          {validation.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="font-marketing-mono text-[9px] tracking-[0.12em] text-mk-dim uppercase">
                {item.label}
              </dt>
              <dd className="font-marketing-mono text-[10.5px] text-mk-muted">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </TerminalFrame>
  );
}
