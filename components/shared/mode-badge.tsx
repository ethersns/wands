import { History, Radio, Zap } from "lucide-react";

import type { TradingMode } from "@/lib/api/contracts";
import { cn } from "@/lib/utils";

const config: Record<
  TradingMode,
  { label: string; icon: typeof Zap; className: string; title: string }
> = {
  backtest: {
    label: "Backtest",
    icon: History,
    className: "border-border bg-muted text-muted-foreground",
    title: "Historical simulation. No orders are sent anywhere.",
  },
  paper: {
    label: "Paper",
    icon: Radio,
    className: "border-primary/30 bg-primary/10 text-primary",
    title: "Simulated execution against market data. No real money at risk.",
  },
  live: {
    label: "Live",
    icon: Zap,
    className: "border-loss/40 bg-loss/12 text-loss",
    title: "Real orders routed to a connected venue.",
  },
};

export function ModeBadge({
  mode,
  className,
}: {
  mode: TradingMode;
  className?: string;
}) {
  const { label, icon: Icon, className: tone, title } = config[mode];

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase",
        tone,
        className,
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {label}
    </span>
  );
}
