import {
  Bot,
  FlaskConical,
  LayoutGrid,
  LineChart,
  ListOrdered,
  Plug,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";

const rail = [
  {
    group: "Operate",
    items: [
      { label: "Dashboard", icon: LayoutGrid },
      { label: "Portfolio", icon: Wallet },
      { label: "Markets", icon: LineChart },
      { label: "Trading Bots", icon: Bot },
      { label: "Trades & Orders", icon: ListOrdered },
    ],
  },
  {
    group: "Research",
    items: [
      { label: "Intelligence", icon: Radar },
      { label: "Strategy Lab", icon: FlaskConical },
      { label: "AI Research", icon: Sparkles },
    ],
  },
  {
    group: "Control",
    items: [
      { label: "Risk Centre", icon: ShieldCheck },
      { label: "Connections", icon: Plug },
      { label: "Settings", icon: Settings },
    ],
  },
];

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-mk-line-strong bg-mk-raised px-2 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.1em] text-mk-dim uppercase",
        className,
      )}
    >
      <span className="size-1 rounded-full bg-mk-warn" aria-hidden />
      Demonstration data
    </span>
  );
}

export function TerminalShell({
  active = "Intelligence",
  tabs,
  activeTab,
  children,
  className,
  footer,
}: {
  active?: string;
  tabs?: string[];
  activeTab?: string;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "@container relative overflow-hidden rounded-lg border border-mk-line-strong bg-mk-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-mk-line bg-mk-deep px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-editorial text-[11px] font-bold tracking-[0.18em] text-mk-fg">
            WANDS
          </span>
          <span className="hidden h-3 w-px bg-mk-line-strong @md:block" aria-hidden />
          <span className="hidden truncate font-marketing-mono text-[10px] tracking-[0.06em] text-mk-dim @md:block">
            Intelligence / SEC filings and signals
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-mk-emerald/25 bg-mk-emerald/10 px-2 py-0.5 font-marketing-mono text-[9px] tracking-[0.1em] text-mk-emerald uppercase @md:inline-flex">
            <span className="size-1 rounded-full bg-mk-emerald" aria-hidden />
            Operational
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-mk-line-strong px-2 py-0.5 font-marketing-mono text-[9px] tracking-[0.1em] text-mk-muted uppercase">
            Paper
          </span>
          <span
            className="size-4 rounded-full border border-mk-line-strong bg-mk-raised"
            aria-hidden
          />
        </div>
      </div>

      <div className="flex">
        <nav
          aria-hidden
          className="hidden w-[9.5rem] shrink-0 flex-col gap-3 border-r border-mk-line bg-mk-deep/50 px-2 py-3 @2xl:flex"
        >
          {rail.map((group) => (
            <div key={group.group} className="flex flex-col gap-0.5">
              <span className="px-1.5 pb-1 font-marketing-mono text-[8.5px] tracking-[0.16em] text-mk-dim uppercase">
                {group.group}
              </span>
              {group.items.map((item) => {
                const isActive = item.label === active;
                const Icon = item.icon;
                return (
                  <span
                    key={item.label}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-1 text-[10.5px]",
                      isActive
                        ? "bg-mk-raised text-mk-fg"
                        : "text-mk-muted",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3 shrink-0",
                        isActive ? "text-mk-accent" : "text-mk-dim",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <Ticker />
          {tabs ? (
            <div className="flex items-center gap-0.5 overflow-hidden border-b border-mk-line px-2 [mask-image:linear-gradient(to_right,#000_88%,transparent)]">
              {tabs.map((tab) => (
                <span
                  key={tab}
                  className={cn(
                    "shrink-0 border-b px-2 py-2 font-marketing-mono text-[9.5px] tracking-[0.06em] whitespace-nowrap uppercase",
                    tab === activeTab
                      ? "border-mk-accent text-mk-fg"
                      : "border-transparent text-mk-dim",
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
          ) : null}
          {children}
        </div>
      </div>

      {footer ? (
        <div className="border-t border-mk-line bg-mk-deep/60 px-3 py-2">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

const tape = [
  { symbol: "NVDA", change: "+2.41%" },
  { symbol: "MSFT", change: "+0.88%" },
  { symbol: "ASML", change: "-1.12%" },
  { symbol: "TSM", change: "+1.94%" },
  { symbol: "COST", change: "+0.34%" },
  { symbol: "AMD", change: "-0.76%" },
  { symbol: "GOOGL", change: "+1.08%" },
  { symbol: "META", change: "+2.02%" },
];

function Ticker() {
  return (
    <div className="flex items-center gap-3 overflow-hidden border-b border-mk-line bg-mk-deep/40 px-3 py-1.5">
      <span className="shrink-0 rounded border border-mk-warn/30 bg-mk-warn/10 px-1.5 py-0.5 font-marketing-mono text-[8.5px] tracking-[0.1em] text-mk-warn uppercase">
        Demo
      </span>
      <div className="relative flex min-w-0 flex-1 items-center overflow-hidden [mask-image:linear-gradient(to_right,#000_90%,transparent)]">
        <div className="mk-ticker flex w-max items-center gap-3">
          {[...tape, ...tape].map((item, index) => (
            <span
              key={`${item.symbol}-${index}`}
              className="flex shrink-0 items-baseline gap-1 font-marketing-mono text-[9.5px] tabular-nums"
            >
              <span className="text-mk-muted">{item.symbol}</span>
              <span
                className={
                  item.change.startsWith("-")
                    ? "text-mk-warn"
                    : "text-mk-emerald"
                }
              >
                {item.change}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "emerald";
}) {
  return (
    <div className="flex flex-col gap-1 border border-mk-line bg-mk-deep/40 px-2.5 py-2">
      <span className="font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-dim uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-marketing-mono text-[15px] leading-none tabular-nums",
          tone === "accent" && "text-mk-accent",
          tone === "emerald" && "text-mk-emerald",
          tone === "default" && "text-mk-fg",
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="truncate text-[9px] text-mk-dim">{hint}</span>
      ) : null}
    </div>
  );
}

export function Meter({
  value,
  tone = "accent",
  className,
}: {
  value: number;
  tone?: "accent" | "emerald" | "silver";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block h-[3px] w-full overflow-hidden rounded-full bg-mk-raised",
        className,
      )}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          tone === "accent" && "bg-mk-accent/80",
          tone === "emerald" && "bg-mk-emerald/80",
          tone === "silver" && "bg-mk-silver/60",
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

export function Provenance({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="font-marketing-mono text-[8.5px] tracking-[0.12em] text-mk-dim uppercase">
            {item.label}
          </dt>
          <dd className="font-marketing-mono text-[9.5px] text-mk-muted">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PanelLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-marketing-mono text-[8.5px] tracking-[0.14em] text-mk-dim uppercase">
        {children}
      </span>
      {action}
    </div>
  );
}
