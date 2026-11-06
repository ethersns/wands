import type { Metadata } from "next";

import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { StrategyLabView } from "@/components/strategy-lab/strategy-lab-view";
import { getBacktests, getPortfolio, getStrategies } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Strategy Lab",
};

export default async function StrategyLabPage() {
  const [strategies, backtests, portfolio] = await Promise.all([
    getStrategies(),
    getBacktests(),
    getPortfolio(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode="backtest" />
            <ProvenanceBadge provenance={backtests.provenance} />
          </>
        }
        title="Strategy Lab"
        description="Build, parameterise and validate strategies against historical data before anything reaches a live venue."
      />

      <DataNotice envelope={backtests} />

      <StrategyLabView
        strategies={strategies.data}
        backtests={backtests.data}
        currency={portfolio.data.baseCurrency}
      />
    </div>
  );
}
