"use client";

import * as React from "react";
import { Loader2, LogOut, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import { recordExitAction } from "@/lib/money/actions";
import { formatDecimal, parseDecimal } from "@/lib/money/calc";
import type { OpenPositionView } from "@/lib/money/types";
import { cn } from "@/lib/utils";

/**
 * An open position, priced from the engine's latest verified quote.
 *
 * When the quote is missing the card says so and shows no P&L. It never falls
 * back to the entry price, because a position displayed as flat when its price
 * is unknown is a lie the founder would act on.
 */

function money(value: string | null, digits = 2): string {
  if (value === null) return "—";
  const parsed = parseDecimal(value);
  if (parsed === null) return value;
  return formatDecimal(parsed, digits);
}

function when(value: string): string {
  return new Date(value).toLocaleString("en-US");
}

export function PositionCard({
  position,
  onOutcome,
}: {
  position: OpenPositionView;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [exitPrice, setExitPrice] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const { trade, quote, quoteError } = position;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setLocalError(null);

    try {
      const result = await recordExitAction(trade.id, { exitPrice, fee });
      onOutcome(result);

      if (result.ok) {
        setExitPrice("");
        setFee("");
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
            <h3 className="font-mono text-base font-semibold text-foreground">{trade.symbol}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {trade.marketType}
            </span>
            <span className="rounded-full border border-profit/30 bg-profit/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-profit">
              Open
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Reported {when(trade.reportedAt)} · your fill, not an exchange confirmation
          </p>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "font-mono text-lg tabular",
              position.unrealizedNet === null
                ? "text-muted-foreground"
                : position.positive
                  ? "text-profit"
                  : "text-loss",
            )}
          >
            {position.unrealizedNet === null ? "—" : `$${position.unrealizedNet}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {position.unrealizedNet === null ? "no current price" : `unrealised · ${position.returnPct}`}
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Your entry
          </dt>
          <dd className="font-mono text-[13px] text-foreground">{money(trade.entryPrice, 4)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Quantity
          </dt>
          <dd className="font-mono text-[13px] text-foreground">
            {money(trade.entryQuantity, 8)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Cost basis
          </dt>
          <dd className="font-mono text-[13px] text-foreground">${position.costBasis}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Current price
          </dt>
          <dd className="font-mono text-[13px] text-foreground">
            {quote ? money(quote.price, 4) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Entry fee
          </dt>
          <dd className="font-mono text-[13px] text-foreground">{money(trade.entryFee, 2)}</dd>
        </div>
      </dl>

      {quote ? (
        <p className="text-[11px] text-muted-foreground">
          Priced by <span className="font-mono text-foreground">{quote.provider}</span> at{" "}
          {when(quote.asOf)}
          {quote.ageSeconds !== null ? ` (${Math.round(quote.ageSeconds)}s old)` : ""} ·{" "}
          {quote.quality}
          {quote.stale ? " · stale" : ""}
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-[12px] text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            No current price, so the P&amp;L is unknown rather than zero.{" "}
            {quoteError ?? "The engine did not return a quote for this symbol."}
          </span>
        </p>
      )}

      {trade.planTargetPrice || trade.planStopPrice ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          {trade.planTargetPrice ? (
            <span>
              Plan target{" "}
              <span className="font-mono text-profit">{money(trade.planTargetPrice, 4)}</span>
            </span>
          ) : null}
          {trade.planStopPrice ? (
            <span>
              Plan stop{" "}
              <span className="font-mono text-loss">{money(trade.planStopPrice, 4)}</span>
            </span>
          ) : null}
          {trade.planReferencePrice ? (
            <span>
              Plan reference{" "}
              <span className="font-mono text-foreground">
                {money(trade.planReferencePrice, 4)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {trade.note ? (
        <p className="text-[12px] leading-relaxed text-pretty text-muted-foreground">{trade.note}</p>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Your exit price
            </span>
            <input
              value={exitPrice}
              onChange={(event) => setExitPrice(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              required
              disabled={pending}
              placeholder={quote ? money(quote.price, 4) : "0.00"}
              className="w-full rounded-md border border-input bg-surface px-2 py-1.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Exit fee (optional)
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

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <LogOut className="size-3" aria-hidden />
            )}
            {pending ? "Recording" : "I Exited"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Sell on your exchange first, then record the fill here.
          </span>
        </div>

        {localError ? (
          <p role="alert" className="text-[11px] text-loss">
            {localError}
          </p>
        ) : null}
      </form>
    </article>
  );
}
