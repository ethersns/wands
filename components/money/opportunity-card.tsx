"use client";

import * as React from "react";
import { CheckCircle2, Loader2, ShieldAlert, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OpportunityCandidate } from "@/lib/api/opportunity";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { formatDecimal, parseDecimal, riskReward } from "@/lib/money/calc";
import { recordEntryAction } from "@/lib/money/actions";
import { cn } from "@/lib/utils";

/**
 * One setup, and the form that records the fill the founder actually got.
 *
 * The entry price is deliberately left empty. Pre-filling it with the engine's
 * reference price would make it one click to record a fill that never happened,
 * and the whole journal would then be a record of the rule rather than of the
 * founder's trading. The reference price is shown beside the field instead, so
 * it is available to compare against without being submittable by accident.
 */

function money(value: string | null, digits = 2): string {
  if (value === null) return "—";
  const parsed = parseDecimal(value);
  if (parsed === null) return value;
  return formatDecimal(parsed, digits);
}

function ratio(candidate: OpportunityCandidate): string {
  const reference = parseDecimal(candidate.referencePrice);
  const target = parseDecimal(candidate.targetPrice);
  const stop = parseDecimal(candidate.invalidationPrice);

  if (reference === null || target === null || stop === null) return "—";

  const value = riskReward({ reference, target, stop });
  if (value === null) return "—";
  return `${value.toFixed(2)} : 1`;
}

export function OpportunityCard({
  candidate,
  alreadyOpen,
  onOutcome,
}: {
  candidate: OpportunityCandidate;
  alreadyOpen: boolean;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [entryPrice, setEntryPrice] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setLocalError(null);

    try {
      const result = await recordEntryAction({
        symbol: candidate.symbol,
        entryPrice,
        quantity,
        fee,
        note,
        candidateId: candidate.id,
        plan: {
          referencePrice: candidate.referencePrice,
          targetPrice: candidate.targetPrice,
          stopPrice: candidate.invalidationPrice,
          reason: candidate.whyQualified,
          strategyKey: candidate.strategyKey,
          strategyVersion: candidate.strategyVersion,
        },
      });

      onOutcome(result);

      if (result.ok) {
        setEntryPrice("");
        setQuantity("");
        setFee("");
        setNote("");
      }
    } catch {
      setLocalError("The request did not reach the server. Nothing was recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-base font-semibold text-foreground">{candidate.symbol}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {candidate.marketType}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {candidate.strategyKey} v{candidate.strategyVersion}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {candidate.whyQualified}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm text-foreground">
            {money(candidate.referencePrice, 4)}
          </div>
          <div className="text-xs text-muted-foreground">reference price</div>
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Entry
          </dt>
          <dd className="font-mono text-sm text-foreground">{money(candidate.referencePrice, 4)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Target
          </dt>
          <dd className="font-mono text-sm text-profit">{money(candidate.targetPrice, 4)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Stop loss
          </dt>
          <dd className="font-mono text-sm text-loss">
            {money(candidate.invalidationPrice, 4)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Risk / reward
          </dt>
          <dd className="font-mono text-sm text-foreground">{ratio(candidate)}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Why it qualified
        </span>
        <p className="text-[12px] leading-relaxed text-pretty text-foreground">
          {candidate.entryCondition} {candidate.invalidationCondition} {candidate.exitCondition}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Volume {candidate.volumeRatio.toFixed(2)}x · max hold {candidate.maxHoldingHours}h ·{" "}
          {candidate.costs.feeBps}bps fee + {candidate.costs.slippageBps}bps slippage assumed
        </p>
      </div>

      {alreadyOpen ? (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-[12px] text-muted-foreground">
          <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-profit" />
          <span>
            You already have an open position recorded for this setup. Close it before recording
            another.
          </span>
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Your entry price
              </span>
              <input
                value={entryPrice}
                onChange={(event) => setEntryPrice(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                required
                disabled={pending}
                placeholder={candidate.referencePrice}
                className="w-full rounded-md border border-input bg-surface px-2 py-1.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Quantity
              </span>
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                required
                disabled={pending}
                placeholder="0.001"
                className="w-full rounded-md border border-input bg-surface px-2 py-1.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Fee (optional)
              </span>
              <input
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                disabled={pending}
                placeholder="0.00"
                className="w-full rounded-md border border-input bg-surface px-2 py-1.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Note (optional)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              disabled={pending}
              placeholder="Anything you want to remember about this fill"
              className="w-full rounded-md border border-input bg-surface px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {pending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Target className="size-3" aria-hidden />
              )}
              {pending ? "Recording" : "I Entered"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Buy on your exchange first, then record the fill here.
            </span>
          </div>

          {localError ? (
            <p role="alert" className="text-[11px] text-loss">
              {localError}
            </p>
          ) : null}
        </form>
      )}

      {candidate.dataQuality.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {candidate.dataQuality.warnings.map((warning) => (
            <li
              key={warning}
              className={cn("flex items-start gap-2 text-[11px] text-muted-foreground")}
            >
              <ShieldAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
