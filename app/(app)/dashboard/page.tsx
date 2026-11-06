import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Plus } from "lucide-react";

import { ActiveBots } from "@/components/dashboard/active-bots";
import { EnginePanel } from "@/components/dashboard/engine-panel";
import { EquityCard } from "@/components/dashboard/equity-card";
import { OverviewStats } from "@/components/dashboard/overview-stats";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { RiskWarnings } from "@/components/dashboard/risk-warnings";
import { AllocationChart, AllocationLegend } from "@/components/charts/allocation-chart";
import { DataNotice } from "@/components/shared/data-notice";
import { EmptyState } from "@/components/shared/empty-state";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  getBots,
  getEngineStatus,
  getOrders,
  getPortfolio,
  getRisk,
} from "@/lib/api/endpoints";
import { formatCurrency } from "@/lib/format";

export const metadata: Metadata = {
  title: "Command centre",
};

export default async function DashboardPage() {
  const [portfolio, bots, orders, risk, engine] = await Promise.all([
    getPortfolio(),
    getBots(),
    getOrders(),
    getRisk(),
    getEngineStatus(),
  ]);

  const data = portfolio.data;
  const runningBots = bots.data.filter((bot) => bot.state === "running");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={portfolio.provenance} />
          </>
        }
        title="Command centre"
        description="Consolidated equity, live strategy activity and risk posture across every connected venue."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/risk">
                Risk Centre
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/bots">
                <Plus className="size-3.5" aria-hidden />
                New bot
              </Link>
            </Button>
          </>
        }
      />

      <DataNotice envelope={portfolio} />

      <OverviewStats portfolio={data} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <EquityCard
            curve={data.equityCurve}
            currency={data.baseCurrency}
            realisedPnl={data.realisedPnl}
            feesPaid={data.feesPaid}
            openPositions={data.openPositions}
          />
        </div>
        <SectionCard
          title="Allocation"
          description="Exposure by asset class"
          bodyClassName="flex flex-col justify-center gap-4"
        >
          <AllocationChart
            data={data.allocation}
            currency={data.baseCurrency}
            height={196}
            centerLabel="Total equity"
            centerValue={formatCurrency(data.totalEquity, data.baseCurrency, {
              compact: true,
            })}
          />
          <AllocationLegend data={data.allocation} currency={data.baseCurrency} />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Open positions"
          description={`${data.openPositions} positions across ${data.accounts.filter((account) => account.status === "connected").length} connected accounts`}
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portfolio">
                Portfolio
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          }
          bodyClassName="px-0 pb-0 sm:px-0"
        >
          {data.positions.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5">
              <EmptyState
                icon={Bot}
                title="No open positions"
                description="Positions appear here once a bot or a manual order fills."
              />
            </div>
          ) : (
            <PositionsTable
              positions={data.positions}
              currency={data.baseCurrency}
              limit={6}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Trading engine"
          description="Operational status and feed health"
        >
          <EnginePanel engine={engine.data} />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard
          title="Active strategies"
          description={`${runningBots.length} running of ${bots.data.length} configured`}
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/bots">
                Manage
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          }
        >
          {bots.data.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No bots configured"
              description="Create a bot to deploy a strategy against a connected account."
            />
          ) : (
            <ActiveBots bots={bots.data} currency={data.baseCurrency} limit={4} />
          )}
        </SectionCard>

        <SectionCard
          title="Recent transactions"
          description="Latest order activity"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/orders">
                All orders
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          }
        >
          <RecentOrders orders={orders.data} limit={5} />
        </SectionCard>

        <SectionCard
          title="Risk warnings"
          description="Breaches requiring attention"
          className="lg:col-span-2 xl:col-span-1"
        >
          <RiskWarnings risk={risk.data} />
        </SectionCard>
      </div>
    </div>
  );
}
