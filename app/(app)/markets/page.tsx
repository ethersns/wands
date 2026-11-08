import type { Metadata } from "next";

import { MarketsView } from "@/components/markets/markets-view";
import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { requireOperator } from "@/lib/admin/guard";
import { getCandles, getEngineStatus, getMarkets } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Markets",
};

export default async function MarketsPage() {
  await requireOperator("/markets");

  const [markets, engine] = await Promise.all([getMarkets(), getEngineStatus()]);

  const firstCrypto =
    markets.data.quotes.find((quote) => quote.marketType === "crypto") ??
    markets.data.quotes[0];

  const initialCandles = firstCrypto
    ? await getCandles(firstCrypto.symbol, "1h")
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={markets.provenance} />
          </>
        }
        title="Markets"
        description="Watchlists, price history and feed health for every instrument the engine can trade."
      />

      <DataNotice envelope={markets} />

      {initialCandles ? (
        <MarketsView overview={markets.data} initialCandles={initialCandles} />
      ) : null}
    </div>
  );
}
