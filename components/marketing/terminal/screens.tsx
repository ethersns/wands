import { cn } from "@/lib/utils";

import {
  Meter,
  PanelLabel,
  Provenance,
  StatTile,
  TerminalShell,
} from "./shell";

const TABS = [
  "Overview",
  "Insider Radar",
  "Institutional Radar",
  "Performance",
  "Data Coverage",
  "Operations",
];

function Th({
  children,
  align = "left",
  hide,
  width,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hide?: "sm" | "md";
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        "px-2.5 py-1.5 font-marketing-mono text-[8.5px] font-medium tracking-[0.12em] text-mk-dim uppercase",
        align === "right" ? "text-right" : "text-left",
        hide === "sm" && "hidden @sm:table-cell",
        hide === "md" && "hidden @md:table-cell",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  hide,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hide?: "sm" | "md";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-2.5 py-2 align-middle",
        align === "right" ? "text-right" : "text-left",
        hide === "sm" && "hidden @sm:table-cell",
        hide === "md" && "hidden @md:table-cell",
        className,
      )}
    >
      {children}
    </td>
  );
}

function TypeChip({ type }: { type: "Buy" | "Sell" | "New" | "Add" | "Trim" }) {
  const positive = type === "Buy" || type === "New" || type === "Add";
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1.5 py-px font-marketing-mono text-[8.5px] tracking-[0.08em] uppercase",
        positive
          ? "border-mk-emerald/25 bg-mk-emerald/10 text-mk-emerald"
          : "border-mk-warn/25 bg-mk-warn/10 text-mk-warn",
      )}
    >
      {type}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

const signals = [
  { ticker: "NVDA", type: "Insider cluster", quality: "High", score: 92, filed: "2d" },
  { ticker: "MSFT", type: "Insider purchase", quality: "High", score: 87, filed: "3d" },
  { ticker: "ASML", type: "13F accumulation", quality: "Medium", score: 81, filed: "4d" },
  { ticker: "COST", type: "Insider purchase", quality: "Medium", score: 74, filed: "6d" },
  { ticker: "TSM", type: "13F reduction", quality: "Medium", score: 68, filed: "7d" },
];

export function OverviewScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Overview"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Source", value: "SEC EDGAR · Form 4 / 13F" },
            { label: "Last run", value: "14m ago" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-mk-emerald/25 bg-mk-emerald/10 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.1em] text-mk-emerald uppercase">
              <span className="size-1 rounded-full bg-mk-emerald" aria-hidden />
              Collection healthy
            </span>
            <span className="rounded border border-mk-line bg-mk-raised px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.1em] text-mk-muted uppercase">
              Research only
            </span>
          </div>
          <span className="font-marketing-mono text-[9px] text-mk-dim">
            Every figure traces to a filing
          </span>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-1.5 @md:grid-cols-6">
          <StatTile label="Filings" value="12,480" hint="SEC documents" />
          <StatTile label="Transactions" value="38,912" hint="Lines parsed" />
          <StatTile label="Signals" value="1,204" hint="Thresholds met" tone="accent" />
          <StatTile label="Institutions" value="4,318" hint="13F filers" />
          <StatTile label="Holdings" value="61,204" hint="Quarterly" />
          <StatTile label="Symbols" value="1,842" hint="With research" />
        </div>

        <div className="mt-2.5 grid gap-2 @xl:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="min-w-0 border border-mk-line bg-mk-deep/30">
            <div className="flex items-center justify-between border-b border-mk-line px-2.5 py-1.5">
              <span className="font-marketing-mono text-[9px] tracking-[0.1em] text-mk-muted uppercase">
                Research signals
              </span>
              <span className="font-marketing-mono text-[8.5px] text-mk-dim">
                Ranked by evidence score
              </span>
            </div>
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                Illustrative research signals ranked by evidence score
              </caption>
              <thead>
                <tr className="border-b border-mk-line">
                  <Th width="20%">Ticker</Th>
                  <Th hide="sm" width="30%">
                    Signal
                  </Th>
                  <Th hide="md" width="18%">
                    Quality
                  </Th>
                  <Th align="right" width="20%">
                    Score
                  </Th>
                  <Th align="right" hide="sm" width="12%">
                    Filed
                  </Th>
                </tr>
              </thead>
              <tbody>
                {signals.map((row) => (
                  <tr
                    key={row.ticker}
                    className="border-b border-mk-line/50 last:border-0"
                  >
                    <Td>
                      <span className="font-marketing-mono text-[10.5px] text-mk-fg">
                        {row.ticker}
                      </span>
                    </Td>
                    <Td hide="sm">
                      <span className="text-[10px] text-mk-muted">{row.type}</span>
                    </Td>
                    <Td hide="md">
                      <span className="text-[10px] text-mk-muted">
                        {row.quality}
                      </span>
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Meter value={row.score} className="hidden w-8 sm:block" />
                        <span className="font-marketing-mono text-[10.5px] tabular-nums text-mk-fg">
                          {row.score}
                        </span>
                      </div>
                    </Td>
                    <Td align="right" hide="sm">
                      <span className="font-marketing-mono text-[9.5px] text-mk-dim">
                        {row.filed}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="border border-mk-line bg-mk-deep/30 p-2.5">
            <PanelLabel
              action={
                <span className="font-marketing-mono text-[9px] text-mk-muted">
                  NVDA
                </span>
              }
            >
              Signal detail
            </PanelLabel>
            <div className="mt-1.5 flex items-end gap-1.5">
              <span className="font-editorial text-2xl leading-none font-semibold tracking-[-0.03em] text-mk-accent">
                92
              </span>
              <span className="pb-0.5 font-marketing-mono text-[8.5px] text-mk-dim">
                / 100 evidence
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {[
                { label: "Cluster activity", value: 96 },
                { label: "Role seniority", value: 88 },
                { label: "Size vs. history", value: 91 },
                { label: "Filing recency", value: 84 },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[9px] text-mk-muted">{item.label}</span>
                    <span className="font-marketing-mono text-[8.5px] tabular-nums text-mk-dim">
                      {item.value}
                    </span>
                  </div>
                  <Meter value={item.value} />
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-mk-line pt-1.5">
              <PanelLabel>Evidence</PanelLabel>
              <ul className="mt-1 flex flex-col gap-1">
                {[
                  "Form 4 · 0001045810-26-000142",
                  "Transaction 2026-11-03",
                  "3 insiders · same window",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1 text-[9px] leading-snug text-mk-muted"
                  >
                    <span
                      className="mt-1 size-0.5 shrink-0 rounded-full bg-mk-accent/70"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </TerminalShell>
  );
}

/* -------------------------------------------------------------------------- */

const insiders = [
  { ticker: "NVDA", company: "NVIDIA Corp", insider: "R. Alvarez", role: "Director", type: "Buy" as const, value: "$2.41M", score: 92, filed: "2d" },
  { ticker: "MSFT", company: "Microsoft Corp", insider: "J. Whitfield", role: "CFO", type: "Buy" as const, value: "$1.08M", score: 87, filed: "3d" },
  { ticker: "ASML", company: "ASML Holding", insider: "P. Vermeer", role: "Director", type: "Buy" as const, value: "$640K", score: 81, filed: "4d" },
  { ticker: "COST", company: "Costco Wholesale", insider: "D. Okafor", role: "EVP", type: "Buy" as const, value: "$412K", score: 74, filed: "6d" },
  { ticker: "TSM", company: "Taiwan Semi.", insider: "L. Chen", role: "Director", type: "Sell" as const, value: "$3.90M", score: 68, filed: "7d" },
];

export function InsiderScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Insider Radar"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Source", value: "SEC Form 4" },
            { label: "Window", value: "30 days" },
            { label: "Ingested", value: "2026-11-04 09:12 UTC" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-mk-line px-2.5 py-1.5">
        {["Window 30d", "Min score 60", "Open-market only", "All sectors"].map(
          (filter) => (
            <span
              key={filter}
              className="rounded border border-mk-line bg-mk-deep/50 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.06em] text-mk-muted"
            >
              {filter}
            </span>
          ),
        )}
        <span className="ml-auto font-marketing-mono text-[8.5px] text-mk-dim">
          1,204 signals
        </span>
      </div>

      <div className="grid @xl:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="min-w-0">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              Illustrative insider transactions with evidence scores
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                <Th width="24%">Security</Th>
                <Th hide="sm" width="20%">
                  Insider
                </Th>
                <Th width="12%">Type</Th>
                <Th align="right" hide="md" width="15%">
                  Value
                </Th>
                <Th align="right" width="17%">
                  Score
                </Th>
                <Th align="right" hide="sm" width="12%">
                  Filed
                </Th>
              </tr>
            </thead>
            <tbody>
              {insiders.map((row) => (
                <tr
                  key={`${row.ticker}-${row.insider}`}
                  className="border-b border-mk-line/50 last:border-0"
                >
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-marketing-mono text-[10.5px] text-mk-fg">
                        {row.ticker}
                      </span>
                      <span className="truncate text-[9px] text-mk-dim">
                        {row.company}
                      </span>
                    </div>
                  </Td>
                  <Td hide="sm">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-mk-fg">{row.insider}</span>
                      <span className="text-[9px] text-mk-dim">{row.role}</span>
                    </div>
                  </Td>
                  <Td>
                    <TypeChip type={row.type} />
                  </Td>
                  <Td align="right" hide="md">
                    <span className="font-marketing-mono text-[10px] tabular-nums text-mk-muted">
                      {row.value}
                    </span>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Meter value={row.score} className="hidden w-8 sm:block" />
                      <span className="font-marketing-mono text-[10.5px] tabular-nums text-mk-fg">
                        {row.score}
                      </span>
                    </div>
                  </Td>
                  <Td align="right" hide="sm">
                    <span className="font-marketing-mono text-[9.5px] text-mk-dim">
                      {row.filed}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="border-t border-mk-line p-2.5 @xl:border-t-0 @xl:border-l">
          <PanelLabel
            action={
              <span className="font-marketing-mono text-[9px] text-mk-muted">
                NVDA
              </span>
            }
          >
            Transaction
          </PanelLabel>
          <dl className="mt-1.5 flex flex-col gap-1">
            {[
              ["Insider", "R. Alvarez"],
              ["Role", "Director"],
              ["Type", "Open-market buy"],
              ["Shares", "18,400"],
              ["Value", "$2.41M"],
              ["Filed", "2026-11-04"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2">
                <dt className="text-[9px] text-mk-dim">{label}</dt>
                <dd className="font-marketing-mono text-[9.5px] text-mk-muted">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 border-t border-mk-line pt-1.5">
            <PanelLabel>Public since</PanelLabel>
            <p className="mt-1 text-[9px] leading-snug text-mk-muted">
              Filed 2 days after the transaction. Wands records both dates so you
              can see when the information became public.
            </p>
          </div>
        </aside>
      </div>
    </TerminalShell>
  );
}

/* -------------------------------------------------------------------------- */

const holdings = [
  { institution: "Vanguard Group", ticker: "NVDA", position: "182.4M", change: "Add", delta: "+4.2%", quarter: "Q3 2026" },
  { institution: "BlackRock", ticker: "MSFT", position: "96.1M", change: "Add", delta: "+1.8%", quarter: "Q3 2026" },
  { institution: "State Street", ticker: "ASML", position: "12.7M", change: "New", delta: "—", quarter: "Q3 2026" },
  { institution: "Wellington", ticker: "COST", position: "4.9M", change: "Trim", delta: "-2.6%", quarter: "Q3 2026" },
  { institution: "Baillie Gifford", ticker: "TSM", position: "8.2M", change: "Trim", delta: "-5.1%", quarter: "Q3 2026" },
];

export function InstitutionScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Institutional Radar"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Source", value: "SEC Form 13F" },
            { label: "Quarter", value: "Q3 2026" },
            { label: "Disclosed", value: "up to 45 days after quarter end" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mk-line px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-mk-line bg-mk-deep/50 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.06em] text-mk-muted">
            Quarter Q3 2026
          </span>
          <span className="rounded border border-mk-line bg-mk-deep/50 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.06em] text-mk-muted">
            All institutions
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded border border-mk-warn/25 bg-mk-warn/10 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.08em] text-mk-warn uppercase">
          Delayed disclosure
        </span>
      </div>

      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          Illustrative institutional holdings reported on Form 13F
        </caption>
        <thead>
          <tr className="border-b border-mk-line">
            <Th width="30%">Institution</Th>
            <Th width="14%">Ticker</Th>
            <Th align="right" hide="sm" width="18%">
              Position
            </Th>
            <Th width="14%">Change</Th>
            <Th align="right" hide="md" width="12%">
              Delta
            </Th>
            <Th align="right" hide="sm" width="12%">
              Quarter
            </Th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((row) => (
            <tr
              key={`${row.institution}-${row.ticker}`}
              className="border-b border-mk-line/50 last:border-0"
            >
              <Td>
                <span className="text-[10px] text-mk-fg">{row.institution}</span>
              </Td>
              <Td>
                <span className="font-marketing-mono text-[10.5px] text-mk-fg">
                  {row.ticker}
                </span>
              </Td>
              <Td align="right" hide="sm">
                <span className="font-marketing-mono text-[10px] tabular-nums text-mk-muted">
                  {row.position}
                </span>
              </Td>
              <Td>
                <TypeChip type={row.change as "New" | "Add" | "Trim"} />
              </Td>
              <Td align="right" hide="md">
                <span
                  className={cn(
                    "font-marketing-mono text-[10px] tabular-nums",
                    row.delta.startsWith("-") ? "text-mk-warn" : "text-mk-emerald",
                  )}
                >
                  {row.delta}
                </span>
              </Td>
              <Td align="right" hide="sm">
                <span className="font-marketing-mono text-[9.5px] text-mk-dim">
                  {row.quarter}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-mk-line bg-mk-deep/40 px-2.5 py-1.5">
        <p className="text-[9px] leading-snug text-mk-muted">
          A 13F is a snapshot published after the quarter closes. Wands shows the
          filing date next to every position so a delayed disclosure is never
          mistaken for a live trade.
        </p>
      </div>
    </TerminalShell>
  );
}

/* -------------------------------------------------------------------------- */

const experiments = [
  { name: "Insider cluster · 30d hold", sample: "1,842 events", quality: "Complete", status: "In development" },
  { name: "13F accumulation · 90d", sample: "612 events", quality: "Partial", status: "In development" },
  { name: "Filing recency weighting", sample: "1,204 events", quality: "Complete", status: "In development" },
  { name: "Sector-neutral baseline", sample: "—", quality: "Pending", status: "Queued" },
];

export function PerformanceScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Performance"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Method", value: "Out-of-sample split" },
            { label: "Costs", value: "Commission + slippage modelled" },
            { label: "Status", value: "Not yet validated" },
          ]}
        />
      }
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-marketing-mono text-[9px] tracking-[0.1em] text-mk-muted uppercase">
            Research experiments
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-mk-warn/25 bg-mk-warn/10 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.08em] text-mk-warn uppercase">
            In development
          </span>
        </div>

        <div className="mt-2 border border-mk-line bg-mk-deep/30">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              Research experiments and their validation status
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                <Th width="40%">Experiment</Th>
                <Th hide="sm" width="22%">
                  Sample
                </Th>
                <Th hide="md" width="20%">
                  Data quality
                </Th>
                <Th align="right" width="18%">
                  Status
                </Th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((row) => (
                <tr
                  key={row.name}
                  className="border-b border-mk-line/50 last:border-0"
                >
                  <Td>
                    <span className="text-[10px] text-mk-fg">{row.name}</span>
                  </Td>
                  <Td hide="sm">
                    <span className="font-marketing-mono text-[9.5px] text-mk-muted">
                      {row.sample}
                    </span>
                  </Td>
                  <Td hide="md">
                    <span className="text-[9.5px] text-mk-muted">
                      {row.quality}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-marketing-mono text-[8.5px] tracking-[0.08em] text-mk-dim uppercase">
                      {row.status}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 grid gap-2 @md:grid-cols-3">
          {[
            { label: "Historical coverage", value: 62, note: "2019 → present" },
            { label: "Cost model", value: 100, note: "Commission + slippage" },
            { label: "Out-of-sample runs", value: 0, note: "Not yet published" },
          ].map((item) => (
            <div
              key={item.label}
              className="border border-mk-line bg-mk-deep/30 px-2.5 py-2"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
                  {item.label}
                </span>
                <span className="font-marketing-mono text-[9.5px] tabular-nums text-mk-muted">
                  {item.value}%
                </span>
              </div>
              <Meter
                value={item.value}
                tone={item.value === 0 ? "silver" : "emerald"}
                className="mt-1.5"
              />
              <p className="mt-1 text-[9px] text-mk-dim">{item.note}</p>
            </div>
          ))}
        </div>

        <p className="mt-2 text-[9px] leading-snug text-mk-muted">
          No performance figures are published until a method survives
          out-of-sample testing. An empty result is a result.
        </p>
      </div>
    </TerminalShell>
  );
}

/* -------------------------------------------------------------------------- */

const sources = [
  { source: "SEC EDGAR · Form 4", records: "38,912", freshness: "14m ago", status: "Healthy" },
  { source: "SEC EDGAR · Form 13F", records: "61,204", freshness: "2h ago", status: "Healthy" },
  { source: "OHLCV market data", records: "1,842 symbols", freshness: "1m ago", status: "Healthy" },
  { source: "Corporate actions", records: "4,106", freshness: "6h ago", status: "Healthy" },
  { source: "Ticker reference", records: "9,480", freshness: "1d ago", status: "Stale" },
];

export function CoverageScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Data Coverage"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Sources", value: "5 connected" },
            { label: "Freshness", value: "tracked per source" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="p-3">
        <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4">
          <StatTile label="Sources" value="5" hint="Connected" />
          <StatTile label="Records" value="115,504" hint="Stored" tone="accent" />
          <StatTile label="Freshness" value="1m" hint="Newest source" tone="emerald" />
          <StatTile label="Gaps" value="1" hint="Needs attention" />
        </div>

        <div className="mt-2 border border-mk-line bg-mk-deep/30">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              Data sources with record counts and freshness
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                <Th width="40%">Source</Th>
                <Th align="right" hide="sm" width="20%">
                  Records
                </Th>
                <Th align="right" hide="md" width="20%">
                  Freshness
                </Th>
                <Th align="right" width="20%">
                  Status
                </Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr
                  key={row.source}
                  className="border-b border-mk-line/50 last:border-0"
                >
                  <Td>
                    <span className="text-[10px] text-mk-fg">{row.source}</span>
                  </Td>
                  <Td align="right" hide="sm">
                    <span className="font-marketing-mono text-[9.5px] tabular-nums text-mk-muted">
                      {row.records}
                    </span>
                  </Td>
                  <Td align="right" hide="md">
                    <span className="font-marketing-mono text-[9.5px] text-mk-dim">
                      {row.freshness}
                    </span>
                  </Td>
                  <Td align="right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-marketing-mono text-[8.5px] tracking-[0.08em] uppercase",
                        row.status === "Healthy"
                          ? "text-mk-emerald"
                          : "text-mk-warn",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1 rounded-full",
                          row.status === "Healthy"
                            ? "bg-mk-emerald"
                            : "bg-mk-warn",
                        )}
                        aria-hidden
                      />
                      {row.status}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TerminalShell>
  );
}

/* -------------------------------------------------------------------------- */

const runs = [
  { source: "Form 4 ingest", started: "09:12", duration: "42s", records: "1,204", status: "Succeeded" },
  { source: "13F parse", started: "08:30", duration: "3m 18s", records: "4,318", status: "Succeeded" },
  { source: "OHLCV sync", started: "09:14", duration: "8s", records: "1,842", status: "Succeeded" },
  { source: "Signal recompute", started: "09:15", duration: "1m 04s", records: "1,204", status: "Running" },
  { source: "Ticker reference", started: "03:00", duration: "—", records: "0", status: "Queued" },
];

export function OperationsScreen({ className }: { className?: string }) {
  return (
    <TerminalShell
      tabs={TABS}
      activeTab="Operations"
      className={className}
      footer={
        <Provenance
          items={[
            { label: "Scheduler", value: "Every 15 minutes" },
            { label: "Last success", value: "09:14 UTC" },
            { label: "Records", value: "Illustrative" },
          ]}
        />
      }
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-marketing-mono text-[9px] tracking-[0.1em] text-mk-muted uppercase">
            Collection runs
          </span>
          <span className="font-marketing-mono text-[8.5px] text-mk-dim">
            Every run is logged with its source and record count
          </span>
        </div>

        <div className="mt-2 border border-mk-line bg-mk-deep/30">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              Illustrative collection run log
            </caption>
            <thead>
              <tr className="border-b border-mk-line">
                <Th width="30%">Source</Th>
                <Th align="right" hide="sm" width="16%">
                  Started
                </Th>
                <Th align="right" hide="md" width="18%">
                  Duration
                </Th>
                <Th align="right" hide="sm" width="18%">
                  Records
                </Th>
                <Th align="right" width="18%">
                  Status
                </Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((row) => (
                <tr
                  key={row.source}
                  className="border-b border-mk-line/50 last:border-0"
                >
                  <Td>
                    <span className="text-[10px] text-mk-fg">{row.source}</span>
                  </Td>
                  <Td align="right" hide="sm">
                    <span className="font-marketing-mono text-[9.5px] tabular-nums text-mk-muted">
                      {row.started}
                    </span>
                  </Td>
                  <Td align="right" hide="md">
                    <span className="font-marketing-mono text-[9.5px] tabular-nums text-mk-dim">
                      {row.duration}
                    </span>
                  </Td>
                  <Td align="right" hide="sm">
                    <span className="font-marketing-mono text-[9.5px] tabular-nums text-mk-muted">
                      {row.records}
                    </span>
                  </Td>
                  <Td align="right">
                    <span
                      className={cn(
                        "font-marketing-mono text-[8.5px] tracking-[0.08em] uppercase",
                        row.status === "Succeeded" && "text-mk-emerald",
                        row.status === "Running" && "text-mk-accent",
                        row.status === "Queued" && "text-mk-dim",
                      )}
                    >
                      {row.status}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TerminalShell>
  );
}

export const screens = [
  {
    id: "overview",
    label: "Intelligence Overview",
    headline: "Everything that changed, ranked by evidence.",
    body: "One surface for filings, transactions, holdings and the signals computed from them.",
    render: OverviewScreen,
  },
  {
    id: "insiders",
    label: "Insider Radar",
    headline: "Insider activity, traced back to the filing.",
    body: "Open-market purchases and sales, scored on cluster activity, seniority and size.",
    render: InsiderScreen,
  },
  {
    id: "institutions",
    label: "Institutional Radar",
    headline: "Holdings changes, with the delay made obvious.",
    body: "13F positions and quarter-over-quarter moves, never presented as a live feed.",
    render: InstitutionScreen,
  },
  {
    id: "performance",
    label: "Research Performance",
    headline: "Validation before publication.",
    body: "Experiments stay labelled in development until a method survives out-of-sample testing.",
    render: PerformanceScreen,
  },
  {
    id: "coverage",
    label: "Data Coverage",
    headline: "Know what the data actually covers.",
    body: "Record counts and freshness for every connected source, including the gaps.",
    render: CoverageScreen,
  },
  {
    id: "operations",
    label: "Operations",
    headline: "Every collection run, on the record.",
    body: "Source, duration and record count for each ingest, so freshness is never a guess.",
    render: OperationsScreen,
  },
] as const;
