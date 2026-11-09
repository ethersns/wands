"use client";

import * as React from "react";
import {
  CheckCircle2,
  Crosshair,
  History,
  Loader2,
  RefreshCw,
  Target,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { OpportunityCandidate } from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { refreshMoneyAction, runMoneyScanAction } from "@/lib/money/actions";
import type { ClosedTradeView, OpenPositionView } from "@/lib/money/types";
import { cn } from "@/lib/utils";
import { OpportunityCard } from "./opportunity-card";
import { PositionCard } from "./position-card";

/**
 * The interactive half of the Money page.
 *
 * The page reads; this component is the only place that writes. Every button
 * reports the server's own answer, so a success is never shown before the
 * backend has confirmed it and a failure is never dressed up as a quiet no-op.
 */

function when(value: string): string {
  return new Date(value).toLocaleString("en-US");
}

function OutcomeBanner({ outcome }: { outcome: ActionOutcome | null }) {
  if (!outcome) return null;
  const Icon = outcome.ok ? CheckCircle2 : XCircle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        outcome.ok ? "border-profit/40 bg-profit/5" : "border-loss/40 bg-loss/5",
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0", outcome.ok ? "text-profit" : "text-loss")}
      />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{outcome.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-pretty text-muted-foreground">
          {outcome.message}
        </p>
        {outcome.detail.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {outcome.detail.map((line) => (
              <li key={line} className="font-mono text-[11px] text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TradeHistory({ trades }: { trades: ClosedTradeView[] }) {
  if (trades.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No closed trades yet. A position appears here once you record its exit.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <caption className="sr-only">
          Closed trades, newest first, with the P&amp;L implied by the prices you reported.
        </caption>
        <thead>
          <tr className="border-b border-border text-left">
            {["Symbol", "Entry", "Exit", "Quantity", "Fees", "Net P&L", "Return", "Closed"].map(
              (heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="py-2 pr-4 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {trades.map((view) => {
            const fees = Number(view.trade.entryFee) + Number(view.trade.exitFee ?? 0);

            return (
              <tr key={view.trade.id} className="border-b border-border/60 last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-mono font-normal text-foreground">
                  {view.trade.symbol}
                </th>
                <td className="py-2 pr-4 font-mono text-muted-foreground">
                  {Number(view.trade.entryPrice).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="py-2 pr-4 font-mono text-muted-foreground">
                  {view.trade.exitPrice
                    ? Number(view.trade.exitPrice).toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })
                    : "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-muted-foreground">
                  {Number(view.trade.entryQuantity).toLocaleString("en-US", {
                    maximumFractionDigits: 8,
                  })}
                </td>
                <td className="py-2 pr-4 font-mono text-muted-foreground">
                  {fees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td
                  className={cn(
                    "py-2 pr-4 font-mono",
                    view.positive ? "text-profit" : "text-loss",
                  )}
                >
                  ${view.netPnl}
                </td>
                <td
                  className={cn("py-2 pr-4 font-mono", view.positive ? "text-profit" : "text-loss")}
                >
                  {view.returnPct}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {view.trade.closedAt ? when(view.trade.closedAt) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MoneyDesk({
  candidates,
  openPositions,
  closedTrades,
  openCandidateIds,
  candidatesError,
}: {
  candidates: OpportunityCandidate[];
  openPositions: OpenPositionView[];
  closedTrades: ClosedTradeView[];
  openCandidateIds: string[];
  candidatesError: string | null;
}) {
  const [outcome, setOutcome] = React.useState<ActionOutcome | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const openSet = React.useMemo(() => new Set(openCandidateIds), [openCandidateIds]);

  async function scan() {
    setScanning(true);
    try {
      setOutcome(await runMoneyScanAction());
    } catch {
      setOutcome({
        ok: false,
        title: "The scan did not run",
        message: "The request did not reach the server. Nothing was recorded.",
        detail: [],
        at: new Date().toISOString(),
      });
    } finally {
      setScanning(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      setOutcome(await refreshMoneyAction());
    } catch {
      setOutcome({
        ok: false,
        title: "Prices were not refreshed",
        message: "The request did not reach the server.",
        detail: [],
        at: new Date().toISOString(),
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OutcomeBanner outcome={outcome} />

      <SectionCard
        title="Opportunities"
        description="Setups the rule qualified on verified candles. A scan is an explicit action because it writes what it finds."
        action={
          <Button type="button" size="sm" variant="outline" onClick={scan} disabled={scanning}>
            {scanning ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            {scanning ? "Scanning" : "Find opportunities"}
          </Button>
        }
      >
        {candidatesError ? (
          <EmptyState
            icon={Crosshair}
            title="The engine could not be reached"
            description={candidatesError}
          />
        ) : candidates.length > 0 ? (
          <div className="flex flex-col gap-4">
            {candidates.map((candidate) => (
              <OpportunityCard
                key={candidate.id}
                candidate={candidate}
                alreadyOpen={openSet.has(candidate.id)}
                onOutcome={setOutcome}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="No qualifying opportunities stored"
            description="Run a scan to apply the rule to the watchlist. A quiet scan is a normal result, not a failure."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Open positions"
        description="Trades you reported and have not yet closed. P&L uses the engine's latest verified quote."
        action={
          openPositions.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3" aria-hidden />
              )}
              {refreshing ? "Refreshing" : "Refresh prices"}
            </Button>
          ) : null
        }
      >
        {openPositions.length > 0 ? (
          <div className="flex flex-col gap-4">
            {openPositions.map((position) => (
              <PositionCard
                key={position.trade.id}
                position={position}
                onOutcome={setOutcome}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="Nothing open"
            description="Record a fill from an opportunity above and it will appear here, priced against the live quote."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Trade history"
        description="Every closed trade, kept whether or not it worked out. P&L is computed from the two prices you reported."
        action={
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <History className="size-3" aria-hidden />
            {closedTrades.length} closed
          </span>
        }
      >
        <TradeHistory trades={closedTrades} />
      </SectionCard>
    </div>
  );
}
