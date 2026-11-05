"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { ModeBadge } from "@/components/shared/mode-badge";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { engineMutation } from "@/lib/api/browser";
import type { Currency, TradingBot } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatPercent,
  formatRelative,
  formatSignedCurrency,
  toneClass,
  toneOf,
} from "@/lib/format";
import { botStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

type Action = "start" | "pause" | "stop";

const actionLabel: Record<Action, string> = {
  start: "Start",
  pause: "Pause",
  stop: "Stop",
};

export function BotCard({
  bot,
  currency,
}: {
  bot: TradingBot;
  currency: Currency;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<Action | null>(null);
  const status = botStatus(bot.state);
  const pnlTone = toneOf(bot.stats.pnl);

  async function run(action: Action) {
    setPending(action);
    const result = await engineMutation<{ state: string }>(
      `bots/${bot.id}/${action}`,
      { method: "POST", body: { botId: bot.id } },
    );
    setPending(null);

    if (!result.ok) {
      toast.error(`${actionLabel[action]} not applied`, {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success(`${bot.name}: ${actionLabel[action].toLowerCase()} acknowledged`);
    router.refresh();
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[13px] font-medium text-foreground">
              {bot.name}
            </h3>
            <StatusChip
              label={status.label}
              tone={status.tone}
              pulse={bot.state === "running"}
            />
            <ModeBadge mode={bot.mode} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {bot.strategyName} · {bot.accountLabel}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-mono text-[13px] tabular", toneClass(pnlTone))}>
            {formatSignedCurrency(bot.stats.pnl, currency)}
          </p>
          <p className="font-mono text-[10px] tabular text-muted-foreground">
            {formatPercent(bot.stats.pnlPct, { signed: true })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 px-4">
        {bot.symbols.map((symbol) => (
          <span
            key={symbol}
            className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {symbol}
          </span>
        ))}
        <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {bot.timeframe}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 px-4 sm:grid-cols-4">
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Capital
          </dt>
          <dd className="font-mono text-[11px] tabular text-foreground">
            {formatCurrency(bot.allocatedCapital, currency, { compact: true })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Win rate
          </dt>
          <dd className="font-mono text-[11px] tabular text-foreground">
            {formatPercent(bot.stats.winRatePct, { digits: 1 })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Max DD
          </dt>
          <dd className="font-mono text-[11px] tabular text-foreground">
            {formatPercent(bot.stats.maxDrawdownPct, { digits: 1 })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Trades
          </dt>
          <dd className="font-mono text-[11px] tabular text-foreground">
            {bot.stats.trades}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
        <Button
          size="sm"
          variant={bot.state === "running" ? "outline" : "default"}
          disabled={pending !== null || bot.state === "running"}
          onClick={() => void run("start")}
        >
          <Play className="size-3" aria-hidden />
          {pending === "start" ? "Starting…" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null || bot.state !== "running"}
          onClick={() => void run("pause")}
        >
          <Pause className="size-3" aria-hidden />
          {pending === "pause" ? "Pausing…" : "Pause"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-loss/30 text-loss hover:bg-loss/10 hover:text-loss"
          disabled={pending !== null || bot.state === "stopped"}
          onClick={() => void run("stop")}
        >
          <Square className="size-3" aria-hidden />
          {pending === "stop" ? "Stopping…" : "Stop"}
        </Button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {formatRelative(bot.lastRunAt)}
        </span>
      </div>

      {bot.lastError ? (
        <p className="border-t border-loss/20 bg-loss/[0.06] px-4 py-2 text-[11px] text-loss">
          {bot.lastError}
        </p>
      ) : null}
    </article>
  );
}
