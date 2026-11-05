"use client";

import * as React from "react";
import { Wallet } from "lucide-react";

import { AccountsTable } from "./accounts-table";
import { AllocationChart, AllocationLegend } from "@/components/charts/allocation-chart";
import { EquityChart } from "@/components/charts/equity-chart";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Stat } from "@/components/shared/stat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MarketType, PortfolioSummary } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  toneOf,
} from "@/lib/format";

function StatRow({ portfolio }: { portfolio: PortfolioSummary }) {
  const currency = portfolio.baseCurrency;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-3 xl:grid-cols-6">
      <div className="bg-card p-4">
        <Stat
          label="Equity"
          value={formatCurrency(portfolio.totalEquity, currency)}
          delta={portfolio.dayPnlPct}
          deltaLabel="today"
          emphasis
          footnote={portfolio.verified === false ? "unverified" : undefined}
        />
      </div>
      <div className="bg-card p-4">
        <Stat label="Cash" value={formatCurrency(portfolio.cash, currency)} />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Reserved"
          value={formatCurrency(portfolio.reserved ?? null, currency)}
          footnote="open orders"
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Buying power"
          value={formatCurrency(portfolio.buyingPower, currency)}
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Realised P&L"
          value={formatSignedCurrency(portfolio.realisedPnl, currency)}
          tone={toneOf(portfolio.realisedPnl)}
          footnote="closed positions"
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Unrealised P&L"
          value={formatSignedCurrency(portfolio.unrealisedPnl, currency)}
          tone={toneOf(portfolio.unrealisedPnl)}
          footnote={`${portfolio.openPositions} open · fees ${formatCurrency(portfolio.feesPaid, currency)}`}
        />
      </div>
    </div>
  );
}

function MarketPanel({
  portfolio,
  market,
}: {
  portfolio: PortfolioSummary;
  market: MarketType;
}) {
  const currency = portfolio.baseCurrency;
  const positions = portfolio.positions.filter((p) => p.marketType === market);
  const slice = portfolio.byMarket[market];
  const unrealised = positions.reduce(
    (sum, position) => sum + (position.unrealisedPnl ?? 0),
    0,
  );
  const realised = positions.reduce(
    (sum, position) => sum + position.realisedPnl,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        <div className="bg-card p-4">
          <Stat
            label={`${market === "crypto" ? "Crypto" : "Stocks"} equity`}
            value={formatCurrency(slice.equity, currency)}
            footnote={`${formatPercent(slice.pct, { digits: 1 })} of portfolio`}
            emphasis
          />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Unrealised"
            value={formatSignedCurrency(unrealised, currency)}
            tone={toneOf(unrealised)}
          />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Realised"
            value={formatSignedCurrency(realised, currency)}
            tone={toneOf(realised)}
          />
        </div>
        <div className="bg-card p-4">
          <Stat label="Positions" value={String(positions.length)} />
        </div>
      </div>

      <SectionCard
        title={`${market === "crypto" ? "Crypto" : "Stock"} holdings`}
        description="Per-asset exposure with realised and unrealised P&L"
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {positions.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Wallet}
              title="No holdings in this market"
              description="Connect an account and deploy a bot, or place a manual order to open a position."
            />
          </div>
        ) : (
          <PositionsTable positions={positions} currency={currency} />
        )}
      </SectionCard>
    </div>
  );
}

export function PortfolioView({ portfolio }: { portfolio: PortfolioSummary }) {
  const currency = portfolio.baseCurrency;

  return (
    <Tabs defaultValue="overview" className="gap-4">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="crypto">Crypto</TabsTrigger>
        <TabsTrigger value="stocks">Stocks</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex flex-col gap-4">
        <StatRow portfolio={portfolio} />

        <div className="grid gap-4 xl:grid-cols-3">
          <SectionCard
            className="xl:col-span-2"
            title="Portfolio history"
            description="Consolidated equity across every connected account"
          >
            <EquityChart
              data={portfolio.equityCurve}
              currency={currency}
              height={260}
            />
          </SectionCard>
          <SectionCard
            title="Allocation"
            description="Exposure by asset class"
            bodyClassName="flex flex-col justify-center gap-4"
          >
            <AllocationChart
              data={portfolio.allocation}
              currency={currency}
              height={196}
              centerLabel="Total equity"
              centerValue={formatCurrency(portfolio.totalEquity, currency, {
                compact: true,
              })}
            />
            <AllocationLegend data={portfolio.allocation} currency={currency} />
          </SectionCard>
        </div>

        <SectionCard
          title="Accounts"
          description="Broker and exchange accounts contributing to this portfolio"
          bodyClassName="px-0 pb-0 sm:px-0"
        >
          <AccountsTable accounts={portfolio.accounts} currency={currency} />
        </SectionCard>

        <SectionCard
          title="All holdings"
          description="Every open position across markets"
          bodyClassName="px-0 pb-0 sm:px-0"
        >
          <PositionsTable positions={portfolio.positions} currency={currency} />
        </SectionCard>
      </TabsContent>

      <TabsContent value="crypto">
        <MarketPanel portfolio={portfolio} market="crypto" />
      </TabsContent>

      <TabsContent value="stocks">
        <MarketPanel portfolio={portfolio} market="stocks" />
      </TabsContent>
    </Tabs>
  );
}
