import type { Metadata } from "next";
import { Bot, CircleAlert, Info, TriangleAlert } from "lucide-react";

import { BotCard } from "@/components/bots/bot-card";
import { CreateBotDialog } from "@/components/bots/create-bot-dialog";
import { DataNotice } from "@/components/shared/data-notice";
import { EmptyState } from "@/components/shared/empty-state";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { Stat } from "@/components/shared/stat";
import { requireOperator } from "@/lib/admin/guard";
import {
  getBotLogs,
  getBots,
  getEngineStatus,
  getPortfolio,
  getStrategies,
} from "@/lib/api/endpoints";
import {
  formatCurrency,
  formatRelative,
  formatSignedCurrency,
  toneOf,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Trading Bots",
};

const levelIcon = {
  info: Info,
  warn: TriangleAlert,
  error: CircleAlert,
} as const;

const levelTone = {
  info: "text-muted-foreground",
  warn: "text-primary",
  error: "text-loss",
} as const;

export default async function BotsPage() {
  await requireOperator("/bots");

  const [bots, logs, strategies, portfolio, engine] = await Promise.all([
    getBots(),
    getBotLogs(),
    getStrategies(),
    getPortfolio(),
    getEngineStatus(),
  ]);

  const currency = portfolio.data.baseCurrency;
  const running = bots.data.filter((bot) => bot.state === "running").length;
  const paused = bots.data.filter((bot) => bot.state === "paused").length;
  const allocated = bots.data.reduce((sum, bot) => sum + bot.allocatedCapital, 0);
  const aggregatePnl = bots.data.reduce((sum, bot) => sum + (bot.stats.pnl ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={bots.provenance} />
          </>
        }
        title="Trading bots"
        description="Configure, deploy and supervise automated strategies. Bots are created stopped and only run when the engine acknowledges a start request."
        actions={
          <CreateBotDialog
            accounts={portfolio.data.accounts}
            strategies={strategies.data}
          />
        }
      />

      <DataNotice envelope={bots} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        <div className="bg-card p-4">
          <Stat label="Running" value={String(running)} footnote={`${bots.data.length} configured`} />
        </div>
        <div className="bg-card p-4">
          <Stat label="Paused" value={String(paused)} footnote="awaiting operator" />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Allocated capital"
            value={formatCurrency(allocated, currency, { compact: true })}
            footnote="across all bots"
          />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Aggregate P&L"
            value={formatSignedCurrency(aggregatePnl, currency)}
            tone={toneOf(aggregatePnl)}
            footnote="since inception"
          />
        </div>
      </div>

      {bots.data.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No bots configured"
          description="Create a bot to deploy a strategy against a connected account. Nothing executes until you start it."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {bots.data.map((bot) => (
            <BotCard key={bot.id} bot={bot} currency={currency} />
          ))}
        </div>
      )}

      <SectionCard
        title="Activity log"
        description="Engine events across every bot, newest first"
      >
        <ul className="flex flex-col divide-y divide-border">
          {logs.data.map((entry) => {
            const Icon = levelIcon[entry.level];
            const bot = bots.data.find((item) => item.id === entry.botId);
            return (
              <li key={entry.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <Icon
                  className={cn("mt-0.5 size-3.5 shrink-0", levelTone[entry.level])}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-relaxed text-foreground">
                    {entry.message}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {bot?.name ?? entry.botId} · {formatRelative(entry.at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[9px] tracking-[0.08em] uppercase",
                    levelTone[entry.level],
                  )}
                >
                  {entry.level}
                </span>
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}
