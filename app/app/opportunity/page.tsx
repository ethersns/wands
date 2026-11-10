import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { OpportunityDesk } from "@/components/opportunity/opportunity-desk";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  getOpportunityBudget,
  getOpportunityCandidates,
  getOpportunityDecisions,
  getOpportunityTests,
} from "@/lib/api/opportunity";
import { requireFounder } from "@/lib/auth/founder";

export const metadata: Metadata = {
  title: "Opportunity Desk",
  description:
    "A private market-discovery workspace with a ranked paper radar, saved setup dismissals, manual paper tests, and an honest journal.",
};

export const dynamic = "force-dynamic";

function money(value: string | null, digits = 2): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function percent(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `${(parsed * 100).toFixed(2)}%`;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-lg text-foreground">{value}</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}

export default async function OpportunityDeskPage() {
  // The desk reads private candidates, decisions, budgets and paper tests, and
  // every read below carries the privileged engine credential. The grant is
  // checked before the first fetch so an unauthorised member never causes one.
  const access = await requireFounder();

  if (!access.ok) {
    if (access.reason === "unauthenticated") {
      redirect(`/signin?next=${encodeURIComponent("/app/opportunity")}`);
    }

    // A member without the grant is told nothing about what lives here.
    notFound();
  }

  const [budgetResult, candidatesResult, decisionsResult, testsResult] = await Promise.all([
    getOpportunityBudget(),
    getOpportunityCandidates(),
    getOpportunityDecisions(),
    getOpportunityTests(),
  ]);

  const budget = budgetResult.ok ? budgetResult.envelope.data : null;
  const candidates = candidatesResult.ok ? candidatesResult.envelope.data.candidates : [];
  const decisions = decisionsResult.ok ? decisionsResult.envelope.data.decisions : [];
  const tests = testsResult.ok ? testsResult.envelope.data.tests : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Private research"
        title="Discover"
        description="Explore measured markets, investigate the evidence, and review strategy tests. Nothing here places an order."
      />

      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-sm text-muted-foreground">
          Radar setups are historical rule matches, not trade recommendations or profit odds. Market Pulse ranks activity only. Nothing here places an order.
        </p>
      </div>

      {budget ? (
        <details className="rounded-lg border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Research Settings · budget and limits</summary>
          <div className="mt-3">
            <SectionCard title="Research budget" description={`${budget.note} ${budget.disclosure}`}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Virtual capital" value={`$${money(budget.startingCapital)}`} />
                <Stat
                  label="Risk per test"
                  value={`$${money(budget.effectiveRiskCeiling)}`}
                  note={`Stricter of the $${money(budget.plannedRiskBudget)} research budget and ${percent(budget.perTradeRiskPct)} per trade`}
                />
                <Stat
                  label="Exposure ceiling"
                  value={`$${money(budget.exposureCeiling)}`}
                  note={`${percent(budget.maxExposurePct)} of virtual capital`}
                />
                <Stat
                  label="Maximum hold"
                  value={`${budget.maxHoldingHours}h`}
                  note="Capped at the session close for stocks"
                />
              </div>
            </SectionCard>
          </div>
        </details>
      ) : null}

      <OpportunityDesk
        candidates={candidates}
        decisions={decisions}
        tests={tests}
        candidatesError={candidatesResult.ok ? null : candidatesResult.error.message}
      />
    </div>
  );
}
