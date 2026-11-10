"use client";

import { useState } from "react";
import { Crosshair } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { OpportunityCandidate } from "@/lib/api/opportunity";
import { recordDecisionAction } from "@/lib/opportunity/actions";

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function PaperRadar({ candidates, error }: {
  candidates: OpportunityCandidate[];
  error: string | null;
}) {
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const contractMissing = candidates.some((candidate) => candidate.latestDecision === undefined);
  const unavailable = error ?? (contractMissing ? "Update the engine to load durable dismissal state. No setups are shown until their saved decisions are available." : null);
  const ranked = candidates
    .filter((candidate) => candidate.latestDecision !== "candidate_rejected" && !confirmed.has(candidate.id))
    .slice()
    .sort((a, b) => b.volumeRatio - a.volumeRatio || b.breakoutMargin - a.breakoutMargin || a.id.localeCompare(b.id));

  async function dismiss(candidate: OpportunityCandidate) {
    setPending(candidate.id);
    setFailure(null);
    setMessage(null);
    try {
      const result = await recordDecisionAction(candidate.id, "candidate_rejected", "Dismissed from Paper Radar.");
      if (result.ok) {
        setConfirmed((previous) => new Set([...previous, candidate.id]));
        setMessage(`${candidate.symbol} dismissed. The engine saved this as a rejected candidate in the journal. No order was placed.`);
      } else {
        setFailure(result.message);
      }
    } catch {
      setFailure("Dismissal could not be confirmed. The setup remains visible; refresh before retrying.");
    } finally {
      setPending(null);
    }
  }

  return (
    <SectionCard title="Paper Radar">
      <div className="flex flex-col gap-4 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          Stored setups from the latest {candidates.length} loaded candidates. Ranked by volume ratio, then breakout margin—not probability of profit. Run the scanner below to collect new setups; this list is not live.
        </p>
        <p className="text-muted-foreground">Research only. Entry ideas and stops are not orders or fills. Dismissals apply to this setup, not future signals for the pair.</p>
        {message ? <p role="status" className="text-foreground">{message}</p> : null}
        {failure ? <p role="alert" className="text-loss">{failure}</p> : null}
        {unavailable ? <p role="alert" className="text-loss">Radar unavailable: {unavailable}</p> : ranked.length === 0 ? (
          <EmptyState icon={Crosshair} title="No undismissed setups" description="Run the scanner below, or review dismissed candidates in the stored candidates and journal. A quiet scan is a normal result." />
        ) : (
          <ol aria-label="Ranked paper setups" className="flex flex-col gap-4">
            {ranked.map((candidate, index) => (
              <li key={candidate.id} className="rounded-lg border border-border bg-card text-card-foreground">
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-mono text-base font-semibold">{index + 1}. {candidate.symbol}</h3>
                    <span>{candidate.strategyKey === "intraday_breakout" && candidate.strategyVersion === 1 ? "LONG" : "Direction not supplied"} · {candidate.marketType}</span>
                  </div>
                  <p>{candidate.whyQualified}</p>
                  <dl className="flex flex-col gap-2">
                    <div><dt className="text-muted-foreground">Entry idea · not a fill</dt><dd>{candidate.entryCondition}</dd></div>
                    <div><dt className="text-muted-foreground">Stop / invalidation price</dt><dd className="break-words font-mono">{candidate.invalidationPrice}</dd></div>
                    <div><dt className="text-muted-foreground">Last scanned / stored (UTC)</dt><dd><time dateTime={candidate.createdAt}>{timestamp(candidate.createdAt)}</time></dd></div>
                  </dl>
                  <p className="text-muted-foreground">{candidate.dataQuality.fresh ? "Data passed freshness checks when scanned; current freshness is not verified." : "Data was not fresh when scanned. Do not treat this as a current setup."}</p>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Setup details · {candidate.symbol}</summary>
                    <div className="flex flex-col gap-3 py-3">
                      <p>Trigger candle timestamp: <time dateTime={candidate.observedAt}>{timestamp(candidate.observedAt)}</time></p>
                      <p>Reference price (not execution): <span className="font-mono">{candidate.referencePrice}</span></p>
                      <p>{candidate.invalidationCondition}</p>
                      <p>{candidate.exitCondition}</p>
                      <p>{candidate.rankReason} Volume ratio: {candidate.volumeRatio.toFixed(2)}x. Breakout margin: {(candidate.breakoutMargin * 100).toFixed(2)}%.</p>
                      <p>Strategy: {candidate.strategyKey} v{candidate.strategyVersion}. Maximum hold: {candidate.maxHoldingHours}h.</p>
                      <p>{candidate.sizing.feasible ? `Research risk at stop: ${candidate.sizing.riskAtStop ?? "Unknown"}. Limited by ${candidate.sizing.bindingConstraint}.` : `Not testable at the research size: ${candidate.sizing.rejectedReason ?? "Sizing unavailable"}.`}</p>
                      <p>Cost assumptions: {candidate.costs.feeBps} bps fee + {candidate.costs.slippageBps} bps slippage. These are not realized costs.</p>
                      {candidate.dataQuality.warnings.map((warning, i) => <p key={i} className="text-muted-foreground">{warning}</p>)}
                    </div>
                  </details>
                  <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto sm:self-start" disabled={pending !== null} onClick={() => dismiss(candidate)} aria-label={`Dismiss ${candidate.symbol} setup`}>
                    {pending === candidate.id ? "Saving dismissal…" : "Dismiss setup"}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SectionCard>
  );
}
