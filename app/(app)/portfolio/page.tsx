import type { Metadata } from "next";

import { PaperAccountPanel } from "@/components/portfolio/paper-account-panel";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { requireOperator } from "@/lib/admin/guard";
import {
  getEngineStatus,
  getPaperAccounts,
  getPortfolio,
} from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default async function PortfolioPage() {
  await requireOperator("/portfolio");

  const [portfolio, engine, paperAccounts] = await Promise.all([
    getPortfolio(),
    getEngineStatus(),
    getPaperAccounts(),
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

      <PaperAccountPanel
        accounts={paperAccounts.data}
        connections={portfolio.data.accounts}
        readOnly={paperAccounts.provenance !== "live"}
      />

      <PortfolioView portfolio={portfolio.data} />
    </div>
  );
}
