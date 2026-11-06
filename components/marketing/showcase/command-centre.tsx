import { cn } from "@/lib/utils";

import { MiniChart } from "../mini-chart";
import { ProvenanceStrip } from "../provenance-strip";
import { TerminalFrame } from "../terminal-frame";

const metrics = [
  { label: "Portfolio value", value: "$1,284,930", hint: "Paper account" },
  { label: "Day P&L", value: "+$8,412", hint: "+0.66%", tone: "accent" },
  { label: "Open risk", value: "62%", hint: "of 80% cap" },
  { label: "Signals today", value: "14", hint: "3 above 85" },
];

const signals = [
  { ticker: "NVDA", reason: "Cluster buy · 3 insiders", score: 92 },
  { ticker: "MSFT", reason: "CFO open-market buy", score: 87 },
  { ticker: "ASML", reason: "New position · Halcyon", score: 84 },
  { ticker: "COST", reason: "Reduced · 2 holders", score: 61 },
];

const limits = [
  { label: "Portfolio exposure", used: 62, cap: "62% of 80%" },
  { label: "Single-name", used: 18, cap: "18% of 25%" },
  { label: "Daily drawdown", used: 34, cap: "1.1% of 3.0%" },
];

const curve = [100, 101, 100.2, 102, 103.4, 102.8, 104.6, 106, 105.2, 107.4, 108.9, 108.1, 110.2, 111.6, 110.9, 112.8];

export function CommandCentreShowcase({ className }: { className?: string }) {
  return (
    <TerminalFrame
      title="Wands / Command Centre"
      tabs={["Operate", "Research", "Control"]}
      activeTab="Operate"
      className={className}
      glow
      footer={
        <ProvenanceStrip
          items={[
            { label: "Engine", value: "Paper" },
            { label: "Data", value: "Filings + market feed" },
            { label: "Updated", value: "09:12 UTC" },
          ]}
        />
      }
    >
      <div className="grid grid-cols-2 divide-mk-line border-b border-mk-line sm:grid-cols-4 sm:divide-x">
        {metrics.map((metric) => (
          <div key={metric.label} className="px-3 py-2.5">
            <p className="font-marketing-mono text-[9px] tracking-[0.12em] text-mk-dim uppercase">
              {metric.label}
            </p>
            <p
              className={cn(
                "mt-1 font-marketing-mono text-[15px] tabular-nums",
                metric.tone === "accent" ? "text-mk-accent" : "text-mk-fg",
              )}
            >
              {metric.value}
            </p>
            <p className="text-[10px] text-mk-dim">{metric.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-mk-line px-3 py-2">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Ranked signals
            </span>
            <span className="font-marketing-mono text-[9.5px] text-mk-dim">
              Score
            </span>
          </div>
          <ul>
            {signals.map((signal) => (
              <li
                key={signal.ticker}
                className="flex items-center justify-between gap-3 border-b border-mk-line/60 px-3 py-2.5 last:border-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-11 shrink-0 font-marketing-mono text-[11.5px] text-mk-fg">
                    {signal.ticker}
                  </span>
                  <span className="truncate text-[11px] text-mk-muted">
                    {signal.reason}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-mk-raised sm:block">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        signal.score >= 80 ? "bg-mk-accent/70" : "bg-mk-warn/60",
                      )}
                      style={{ width: `${signal.score}%` }}
                    />
                  </span>
                  <span className="font-marketing-mono text-[11.5px] tabular-nums text-mk-fg">
                    {signal.score}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="border-t border-mk-line p-3 lg:border-t-0 lg:border-l">
          <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
            Risk limits
          </span>
          <div className="mt-2 flex flex-col gap-2.5">
            {limits.map((limit) => (
              <div key={limit.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] text-mk-muted">
                    {limit.label}
                  </span>
                  <span className="font-marketing-mono text-[9.5px] text-mk-dim">
                    {limit.cap}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-mk-raised">
                  <div
                    className="h-full rounded-full bg-mk-accent/60"
                    style={{ width: `${limit.used}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-mk-line pt-2.5">
            <span className="font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-dim uppercase">
              Equity · 30d
            </span>
            <div className="mt-1.5 h-14">
              <MiniChart
                series={curve}
                height={56}
                label="Illustrative 30-day equity curve"
              />
            </div>
          </div>
        </aside>
      </div>
    </TerminalFrame>
  );
}
