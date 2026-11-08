import type { Metadata } from "next";
import { Crosshair, Info, ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  getOpportunityBudget,
  getOpportunityScan,
  type OpportunityCandidate,
} from "@/lib/api/opportunity";

export const metadata: Metadata = {
  title: "Opportunity Desk",
  description:
    "A private research workspace for short-term setups, with manual paper tests and an honest journal.",
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

function CandidateCard({ candidate }: { candidate: OpportunityCandidate }) {
  const { sizing, dataQuality } = candidate;
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-base font-semibold text-foreground">
              {candidate.symbol}
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {candidate.marketType}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{candidate.whyQualified}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm text-foreground">
            {money(candidate.referencePrice, 4)}
          </div>
          <div className="text-xs text-muted-foreground">reference price</div>
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Entry</dt>
          <dd className="text-sm text-foreground">{candidate.entryCondition}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Invalidation
          </dt>
          <dd className="text-sm text-foreground">{candidate.invalidationCondition}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Exit</dt>
          <dd className="text-sm text-foreground">{candidate.exitCondition}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          Strategy{" "}
          <span className="font-mono text-foreground">
            {candidate.strategyKey} v{candidate.strategyVersion}
          </span>
        </span>
        <span>
          Volume{" "}
          <span className="font-mono text-foreground">
            {candidate.volumeRatio.toFixed(2)}x
          </span>
        </span>
        <span>
          Costs{" "}
          <span className="font-mono text-foreground">
            {candidate.costs.feeBps}bps fee + {candidate.costs.slippageBps}bps slippage
          </span>
        </span>
        <span>
          Max hold{" "}
          <span className="font-mono text-foreground">
            {candidate.maxHoldingHours}h
          </span>
        </span>
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        {sizing.feasible ? (
          <p className="text-sm text-foreground">
            Research size{" "}
            <span className="font-mono">{money(sizing.quantity, 8)}</span> units,{" "}
            <span className="font-mono">{money(sizing.notional)}</span> notional,{" "}
            <span className="font-mono">{money(sizing.riskAtStop)}</span> at the stop.
            Limited by {sizing.bindingConstraint}.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-foreground">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Not testable at this size. {sizing.rejectedReason}
            </span>
          </p>
        )}
      </div>

      {dataQuality.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {dataQuality.warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-2 text-xs text-muted-foreground"
            >
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">{candidate.rankReason}</p>
    </article>
  );
}

export default async function OpportunityDeskPage() {
  const [scanResult, budgetResult] = await Promise.all([
    getOpportunityScan(),
    getOpportunityBudget(),
  ]);

  const budget = budgetResult.ok ? budgetResult.envelope.data : null;
  const scan = scanResult.ok ? scanResult.envelope.data : null;
  const warnings = scanResult.ok ? scanResult.envelope.warnings : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Private research"
        title="Opportunity Desk"
        description="Short-term setups the rule found, with the conditions written down before the outcome is known. Nothing here places an order."
      />

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {budget?.disclosure ??
            "Research only. A candidate is a hypothesis to look at, not a trade instruction, and no result here is a probability of profit."}
        </p>
      </div>

      {budget ? (
        <SectionCard
          title="Research budget"
          description={budget.note}
        >
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
            <Stat label="Maximum hold" value={`${budget.maxHoldingHours}h`} note="Capped at the session close for stocks" />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Candidates"
        description={
          scan
            ? `Scanned at ${new Date(scan.generatedAt).toLocaleString("en-US")} on ${scan.interval} candles.`
            : undefined
        }
      >
        {!scanResult.ok ? (
          <EmptyState
            icon={Crosshair}
            title="The engine could not be reached"
            description={scanResult.error.message}
          />
        ) : scan && scan.candidates.length > 0 ? (
          <div className="flex flex-col gap-4">
            {scan.candidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Crosshair}
            title="No qualifying opportunities found."
            description="The rule did not find a setup that met its conditions. A quiet scan is a normal result, not a failure."
          />
        )}
      </SectionCard>

      {scan && scan.skipped.length > 0 ? (
        <SectionCard
          title="What was skipped, and why"
          description="Every symbol the scan passed over, so a quiet result can be told apart from a broken one."
        >
          <ul className="flex flex-col divide-y divide-border">
            {scan.skipped.map((item) => (
              <li
                key={`${item.symbol}-${item.reason}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-mono text-foreground">{item.symbol}</span>
                <span className="text-muted-foreground">{item.reason}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs text-muted-foreground">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
