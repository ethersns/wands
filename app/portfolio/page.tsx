import type { Metadata } from "next";

import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { getEngineStatus, getPortfolio } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default async function PortfolioPage() {
  const [portfolio, engine] = await Promise.all([
    getPortfolio(),
    getEngineStatus(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={portfolio.provenance} />
          </>
        }
        title="Portfolio"
        description="Unified view across brokers and exchanges, with realised and unrealised P&L per asset."
      />

      <DataNotice envelope={portfolio} />

      <PortfolioView portfolio={portfolio.data} />
    </div>
  );
}
