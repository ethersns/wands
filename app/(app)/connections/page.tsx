import type { Metadata } from "next";
import { Lock, Server } from "lucide-react";

import { ConnectionsView } from "@/components/connections/connections-view";
import { DataNotice } from "@/components/shared/data-notice";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { getConnections, getPortfolio } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Connections",
};

export default async function ConnectionsPage() {
  const [connections, portfolio] = await Promise.all([
    getConnections(),
    getPortfolio(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={<ProvenanceBadge provenance={connections.provenance} />}
        title="Connections"
        description="Exchanges and brokers the engine can read from and, once authorised, trade through."
      />

      <DataNotice envelope={connections} />

      <ConnectionsView
        connections={connections.data}
        accounts={portfolio.data.accounts}
        currency={portfolio.data.baseCurrency}
      />

      <SectionCard
        title="How credentials are handled"
        description="Security model for venue access"
        bodyClassName="grid gap-3 sm:grid-cols-2"
      >
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Keys are posted once to the private engine over TLS and stored encrypted
            server-side. The browser never persists them, and only the last four
            characters are ever returned.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Server className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The frontend never calls an exchange directly. Every order is routed by
            the engine, which enforces the risk policy before submission.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
