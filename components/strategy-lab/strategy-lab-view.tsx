"use client";

import * as React from "react";
import { Download, ListOrdered } from "lucide-react";

import { StrategyCard } from "./strategy-card";
import { EquityChart } from "@/components/charts/equity-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BacktestResult, Currency, Strategy } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  toneClass,
  toneOf,
} from "@/lib/format";
import { cn } from "@/lib/utils";

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("font-mono text-[13px] tabular text-foreground", tone)}>
        {value}
      </span>
    </div>
  );
}

function BacktestDetail({
  backtest,
  currency,
}: {
  backtest: BacktestResult;
  currency: Currency;
}) {
  const m = backtest.metrics;
  const verdictTone =
    backtest.walkForward?.verdict === "passed"
      ? "profit"
      : backtest.walkForward?.verdict === "failed"
        ? "loss"
        : "primary";

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title={backtest.strategyName}
        description={`${backtest.symbols.join(", ")} · ${backtest.timeframe} · ${formatDate(backtest.from)} → ${formatDate(backtest.to)}`}
        action={
          <Button variant="outline" size="sm" disabled>
            <Download className="size-3" aria-hidden />
            Export
          </Button>
        }
        bodyClassName="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Total return"
            value={formatPercent(m.totalReturnPct, { signed: true })}
            tone={toneClass(toneOf(m.totalReturnPct))}
          />
          <Metric
            label="Benchmark"
            value={formatPercent(m.benchmarkReturnPct, { signed: true })}
            tone={toneClass(toneOf(m.benchmarkReturnPct))}
          />
          <Metric label="Profit factor" value={formatNumber(m.profitFactor)} />
          <Metric
            label="Max drawdown"
            value={formatPercent(m.maxDrawdownPct, { digits: 1 })}
            tone="text-loss"
          />
          <Metric
            label="Win rate"
            value={formatPercent(m.winRatePct, { digits: 1 })}
          />
          <Metric label="Avg win" value={formatCurrency(m.averageWin, currency)} />
          <Metric label="Avg loss" value={formatCurrency(m.averageLoss, currency)} />
          <Metric label="Sharpe" value={formatNumber(m.sharpe)} />
          <Metric label="Trades" value={String(m.trades)} />
          <Metric label="Fees" value={formatCurrency(m.feesPaid, currency)} />
        </div>

        <div className="border-t border-border pt-3">
          <EquityChart
            data={backtest.equityCurve}
            currency={currency}
            height={240}
          />
        </div>

        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground">
                Walk-forward validation
              </span>
              {backtest.walkForward ? (
                <StatusChip
                  label={backtest.walkForward.verdict}
                  tone={verdictTone}
                />
              ) : (
                <StatusChip label="Not run" tone="muted" />
              )}
            </div>
            {backtest.walkForward ? (
              <dl className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-[10px] text-muted-foreground uppercase">Folds</dt>
                  <dd className="font-mono text-[12px] tabular text-foreground">
                    {backtest.walkForward.folds}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-muted-foreground uppercase">In-sample</dt>
                  <dd className="font-mono text-[12px] tabular text-foreground">
                    {formatPercent(backtest.walkForward.inSampleReturnPct, {
                      signed: true,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-muted-foreground uppercase">Out-of-sample</dt>
                  <dd
                    className={cn(
                      "font-mono text-[12px] tabular",
                      toneClass(toneOf(backtest.walkForward.outOfSampleReturnPct)),
                    )}
                  >
                    {formatPercent(backtest.walkForward.outOfSampleReturnPct, {
                      signed: true,
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                This run did not include walk-forward folds.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface/60 p-3">
            <span className="text-[11px] font-medium text-foreground">
              Cost model
            </span>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[10px] text-muted-foreground uppercase">Fees</dt>
                <dd className="font-mono text-[12px] tabular text-foreground">
                  {formatCurrency(m.feesPaid, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground uppercase">
                  Est. slippage
                </dt>
                <dd className="font-mono text-[12px] tabular text-foreground">
                  {formatCurrency(m.estimatedSlippage, currency)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Past performance is not indicative of future results. No strategy
              guarantees profit.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Trade breakdown"
        description="Every simulated entry and exit in this run"
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {backtest.trades.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ListOrdered}
              title="Trade-level detail not returned"
              description="The engine returns per-trade rows with this backtest. None were included in this payload."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backtest.trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-mono text-[12px]">{trade.symbol}</TableCell>
                  <TableCell className="text-[11px] uppercase">{trade.side}</TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular">
                    {formatNumber(trade.entryPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular">
                    {formatNumber(trade.exitPrice)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-[12px] tabular",
                      toneClass(toneOf(trade.pnl)),
                    )}
                  >
                    {formatCurrency(trade.pnl, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

export function StrategyLabView({
  strategies,
  backtests,
  currency,
}: {
  strategies: Strategy[];
  backtests: BacktestResult[];
  currency: Currency;
}) {
  const [selectedId, setSelectedId] = React.useState(backtests[0]?.id ?? "");
  const selected =
    backtests.find((backtest) => backtest.id === selectedId) ?? backtests[0];

  return (
    <Tabs defaultValue="library" className="gap-4">
      <TabsList>
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="backtests">Backtests</TabsTrigger>
        <TabsTrigger value="compare">Compare</TabsTrigger>
      </TabsList>

      <TabsContent value="library">
        <div className="grid gap-4 lg:grid-cols-2">
          {strategies.map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="backtests">
        {backtests.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title="No backtests yet"
            description="Run a backtest from the strategy library to populate this view."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1">
              {backtests.map((backtest) => (
                <button
                  key={backtest.id}
                  type="button"
                  onClick={() => setSelectedId(backtest.id)}
                  aria-current={backtest.id === selected?.id ? "true" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-2 text-left transition-colors",
                    backtest.id === selected?.id
                      ? "bg-secondary"
                      : "hover:bg-accent/60",
                  )}
                >
                  <p className="truncate text-[12px] font-medium text-foreground">
                    {backtest.strategyName}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {backtest.symbols.join(", ")} · {backtest.timeframe}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono text-[10px] tabular",
                      toneClass(toneOf(backtest.metrics.totalReturnPct)),
                    )}
                  >
                    {formatPercent(backtest.metrics.totalReturnPct, { signed: true })}
                  </p>
                </button>
              ))}
            </div>
            {selected ? (
              <BacktestDetail backtest={selected} currency={currency} />
            ) : null}
          </div>
        )}
      </TabsContent>

      <TabsContent value="compare">
        <SectionCard
          title="Strategy comparison"
          description="Side-by-side metrics across every completed backtest"
          bodyClassName="px-0 pb-0 sm:px-0"
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Benchmark</TableHead>
                <TableHead className="text-right">Profit factor</TableHead>
                <TableHead className="text-right">Max DD</TableHead>
                <TableHead className="hidden text-right md:table-cell">Win rate</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Sharpe</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Trades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backtests.map((backtest) => (
                <TableRow key={backtest.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-medium text-foreground">
                        {backtest.strategyName}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {backtest.symbols.join(", ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-[12px] tabular",
                      toneClass(toneOf(backtest.metrics.totalReturnPct)),
                    )}
                  >
                    {formatPercent(backtest.metrics.totalReturnPct, { signed: true })}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12px] tabular text-muted-foreground sm:table-cell">
                    {formatPercent(backtest.metrics.benchmarkReturnPct, { signed: true })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                    {formatNumber(backtest.metrics.profitFactor)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular text-loss">
                    {formatPercent(backtest.metrics.maxDrawdownPct, { digits: 1 })}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12px] tabular text-foreground md:table-cell">
                    {formatPercent(backtest.metrics.winRatePct, { digits: 1 })}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12px] tabular text-foreground lg:table-cell">
                    {formatNumber(backtest.metrics.sharpe)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12px] tabular text-muted-foreground lg:table-cell">
                    {backtest.metrics.trades}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}
