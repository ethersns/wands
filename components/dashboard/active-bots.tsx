import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { StatusChip } from "@/components/shared/status-chip";
import { ModeBadge } from "@/components/shared/mode-badge";
import type { Currency, TradingBot } from "@/lib/api/contracts";
import {
  formatPercent,
  formatRelative,
  formatSignedCurrency,
  toneClass,
  toneOf,
} from "@/lib/format";
import { botStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export function ActiveBots({
  bots,
  currency,
  limit = 4,
}: {
  bots: TradingBot[];
  currency: Currency;
  limit?: number;
}) {
  const rows = bots.slice(0, limit);

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((bot) => {
        const status = botStatus(bot.state);
        const tone = toneOf(bot.stats.pnl);
        return (
          <li key={bot.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    href="/bots"
                    className="truncate text-[12px] font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {bot.name}
                  </Link>
                  <StatusChip label={status.label} tone={status.tone} />
                  <ModeBadge mode={bot.mode} />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {bot.strategyName} · {bot.symbols.join(", ")} · {bot.timeframe}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("font-mono text-[12px] tabular", toneClass(tone))}>
                  {formatSignedCurrency(bot.stats.pnl, currency)}
                </p>
                <p className="font-mono text-[10px] tabular text-muted-foreground">
                  {formatPercent(bot.stats.pnlPct, { signed: true })} ·{" "}
                  {bot.stats.trades} trades
                </p>
              </div>
            </div>
            <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground/70">
              last run {formatRelative(bot.lastRunAt)}
              <ArrowUpRight className="size-2.5" aria-hidden />
            </p>
          </li>
        );
      })}
    </ul>
  );
}
