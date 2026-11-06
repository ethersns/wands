import type { Metadata } from "next";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";

import { ResearchChat } from "@/components/research/research-chat";
import { DataNotice } from "@/components/shared/data-notice";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { getPortfolio, getRisk } from "@/lib/api/endpoints";
import { formatCurrency, formatPercent } from "@/lib/format";

export const metadata: Metadata = {
  title: "AI Research",
};

const GUARDRAILS = [
  "Cannot place, amend or cancel orders",
  "Cannot enable live trading",
  "Cannot change risk limits or bot configuration",
  "Cannot read or reveal API keys",
  "Never presents demo figures as a real account",
];

export default async function ResearchPage() {
  const [portfolio, risk] = await Promise.all([getPortfolio(), getRisk()]);

  const p = portfolio.data;
  const r = risk.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={portfolio.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
          </>
        }
        title="AI Research"
        description="A research assistant grounded in your live portfolio, risk policy and backtest history. It analyses and explains — it never executes."
      />

      <DataNotice envelope={portfolio} compact />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ResearchChat />

        <div className="flex flex-col gap-4">
          <SectionCard
            title="Guardrails"
            description="Enforced in the system prompt"
            bodyClassName="flex flex-col gap-2"
          >
            <ul className="flex flex-col gap-1.5">
              {GUARDRAILS.map((rule) => (
                <li key={rule} className="flex items-start gap-2">
                  <Lock
                    className="mt-0.5 size-3 shrink-0 text-muted-foreground/70"
                    aria-hidden
                  />
                  <span className="text-[11px] leading-relaxed text-muted-foreground">
                    {rule}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            title="Context in use"
            description="Injected into every request"
            bodyClassName="flex flex-col gap-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Equity</span>
              <span className="font-mono text-[12px] tabular text-foreground">
                {formatCurrency(p.totalEquity, p.baseCurrency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Open positions</span>
              <span className="font-mono text-[12px] tabular text-foreground">
                {p.openPositions}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Exposure</span>
              <span className="font-mono text-[12px] tabular text-foreground">
                {formatPercent(r.utilisation.portfolioExposurePct, { digits: 1 })}
                <span className="text-muted-foreground">
                  {" "}
                  / {r.policy.maxPortfolioExposurePct}%
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Open breaches</span>
              <span className="font-mono text-[12px] tabular text-foreground">
                {r.breaches.length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Trading paused</span>
              <span className="font-mono text-[12px] tabular text-foreground">
                {r.policy.tradingPaused ? "yes" : "no"}
              </span>
            </div>
          </SectionCard>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
            <ShieldCheck
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Model output is not investment advice. Validate any proposal in the
              Strategy Lab before it reaches a bot.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
