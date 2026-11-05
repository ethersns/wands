"use client";

import * as React from "react";

import { EquityChart } from "@/components/charts/equity-chart";
import { SectionCard } from "@/components/shared/section-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Currency, EquityPoint } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  toneClass,
  toneOf,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "30", label: "30D", days: 30 },
  { value: "90", label: "90D", days: 90 },
  { value: "180", label: "180D", days: 180 },
  { value: "all", label: "All", days: 0 },
] as const;

export function EquityCard({
  curve,
  currency,
  realisedPnl,
  feesPaid,
  openPositions,
}: {
  curve: EquityPoint[];
  currency: Currency;
  realisedPnl: number | null;
  feesPaid: number | null;
  openPositions: number;
}) {
  const [range, setRange] = React.useState<string>("90");

  const data = React.useMemo(() => {
    const config = RANGES.find((item) => item.value === range) ?? RANGES[1];
    if (config.days === 0) return curve;
    return curve.slice(-config.days);
  }, [curve, range]);

  const first = data[0];
  const last = data[data.length - 1];
  const change =
    first && last && first.equity !== 0
      ? ((last.equity - first.equity) / first.equity) * 100
      : null;
  const benchmarkChange =
    first?.benchmark && last?.benchmark
      ? ((last.benchmark - first.benchmark) / first.benchmark) * 100
      : null;
  const excess =
    change !== null && benchmarkChange !== null ? change - benchmarkChange : null;

  return (
    <SectionCard
      title="Equity curve"
      description="Account equity against a buy-and-hold benchmark"
      action={
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="h-8">
            {RANGES.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="h-7 px-2 font-mono text-[11px]"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      bodyClassName="pb-2"
      footer={
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              Period return
            </dt>
            <dd
              className={cn(
                "font-mono text-[12px] tabular",
                toneClass(toneOf(change)),
              )}
            >
              {formatPercent(change, { signed: true })}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              vs benchmark
            </dt>
            <dd
              className={cn(
                "font-mono text-[12px] tabular",
                toneClass(toneOf(excess)),
              )}
            >
              {formatPercent(excess, { signed: true })}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              Realised P&L
            </dt>
            <dd
              className={cn(
                "font-mono text-[12px] tabular",
                toneClass(toneOf(realisedPnl)),
              )}
            >
              {formatSignedCurrency(realisedPnl, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              Fees · positions
            </dt>
            <dd className="font-mono text-[12px] tabular text-muted-foreground">
              {formatCurrency(feesPaid, currency)} · {openPositions}
            </dd>
          </div>
        </dl>
      }
    >
      <EquityChart data={data} currency={currency} height={248} />
    </SectionCard>
  );
}
