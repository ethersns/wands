import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Radar, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { CoverageDisclosure } from "@/components/intelligence/coverage-disclosure";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { SymbolSearch } from "@/components/intelligence/symbol-search";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { getIntelStatus } from "@/lib/api/endpoints";
import { getPublicCoverage } from "@/lib/api/research";

export const metadata: Metadata = {
  title: "Asset Research",
  description:
    "Per-asset research built from SEC insider filings and institutional disclosures, with the source document behind every claim.",
};

export default async function AssetResearchIndexPage() {
  const [status, coverage] = await Promise.all([
    getIntelStatus(),
    getPublicCoverage(),
  ]);

  const symbols = status.data.symbolsCovered;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={status.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Radar className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator
              freshness={status.data.freshness}
              lastSuccessAt={status.data.latestFilingAt}
            />
          </>
        }
        title="Asset research"
        description="One asset at a time: the insider activity reported to the SEC, the signals computed from it, and the filing behind each claim. A research score ranks evidence — it is not a probability of profit."
        actions={<SymbolSearch />}
      />

      <UnavailablePanel
        envelope={status}
        title="Research collection is not reporting"
      />

      <CoverageDisclosure coverage={coverage.data} />

      <SectionCard
        title="Symbols with stored research"
        description="A symbol appears here once a filing has been ingested and a signal computed. Absence means nothing is stored, not that nothing happened."
        bodyClassName="p-0"
        footer={
          <ProvenanceLabel
            provenance={status.provenance}
            source={status.source}
            generatedAt={status.generatedAt}
          />
        }
      >
        {symbols.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Radar}
              title="No symbol has stored research yet"
              description="Enter a ticker above to look one up directly. If the engine has nothing stored for it, the page will say so rather than showing an empty score."
            />
          </div>
        ) : (
          <ul className="grid grid-cols-2 divide-y divide-border sm:grid-cols-3 lg:grid-cols-4">
            {symbols.map((ticker) => (
              <li key={ticker} className="border-b border-border">
                <Link
                  href={`/intelligence/symbols/${encodeURIComponent(ticker)}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-5"
                >
                  <span className="font-mono text-[12px] font-medium text-foreground">
                    {ticker}
                  </span>
                  <ArrowRight
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <ShieldCheck
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Asset research is informational. Nothing on this page can place an
          order, reach a broker, change a risk limit or enable live trading, and
          no signal is ever routed to a bot automatically.
        </p>
      </div>
    </div>
  );
}
