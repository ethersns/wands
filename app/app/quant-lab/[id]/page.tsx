import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuantSeriesExplorer } from "@/components/member/quant-series-explorer";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  ProvenanceNote,
  StatTile,
} from "@/components/member/ui";
import type { QuantCategory } from "@/lib/api/research-contract";
import {
  formatCount,
  formatPercent,
  formatPValue,
  formatShare,
  periodLabel,
  statusLabel,
  statusTone,
  studyLabel,
} from "@/lib/member/quant";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Experiment" };

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
        {label}
      </dt>
      <dd className="mt-0.5 font-marketing-mono text-sm tabular-nums text-mk-fg">{value}</dd>
      {note ? (
        <p className="mt-0.5 text-[11px] leading-relaxed text-mk-dim text-pretty">{note}</p>
      ) : null}
    </div>
  );
}

function CategoryRow({ category }: { category: QuantCategory }) {
  const horizon = category.horizons?.find((item) => item.horizonDays === 20) ?? category.horizons?.[0];
  const mean = horizon?.descriptive?.mean ?? null;
  const pValue = horizon?.significance?.pValue ?? null;

  return (
    <tr className="border-b border-mk-line last:border-0">
      <td className="py-2.5 pr-3 text-sm text-mk-fg">
        {category.category.replace(/^institutional_/, "").replace(/_/g, " ")}
      </td>
      <td className="py-2.5 pr-3 font-marketing-mono text-sm tabular-nums text-mk-fg">
        {formatCount(category.sampleSize)}
      </td>
      <td className="py-2.5 pr-3 font-marketing-mono text-sm tabular-nums text-mk-fg">
        {formatPercent(mean)}
      </td>
      <td className="py-2.5 pr-3 font-marketing-mono text-sm tabular-nums text-mk-muted">
        {formatPValue(pValue)}
      </td>
      <td className="py-2.5">
        <Badge tone={statusTone(category.status)}>{statusLabel(category.status)}</Badge>
      </td>
    </tr>
  );
}

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireMember(`/app/quant-lab/${id}`);

  const envelope = await memberResearch.experiment(id);
  const experiment = envelope.data;

  if (!experiment) {
    if (envelope.unreachable) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader eyebrow="Quant Lab" title="Experiment unavailable" />
          <ProvenanceNote
            provenance={envelope.provenance}
            generatedAt={envelope.generatedAt}
            warnings={envelope.warnings}
            unreachable
          />
          <Link
            href="/app/quant-lab"
            className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Back to the lab
          </Link>
        </div>
      );
    }
    notFound();
  }

  const result = experiment.metrics;
  const study = result?.study;
  const summary = result?.summary;
  const categories = result?.categories ?? [];
  const series = result?.series ?? [];
  const limitations = result?.limitations ?? [];
  const flags = result?.flags ?? experiment.flags ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/app/quant-lab"
          className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim underline-offset-4 hover:text-mk-fg hover:underline"
        >
          Quant Lab
        </Link>
      </div>

      <PageHeader
        eyebrow={studyLabel(study)}
        title={experiment.name}
        description={`${periodLabel(experiment)} · benchmark ${experiment.benchmark || "—"} · ${formatCount(
          experiment.sampleSize,
        )} observations`}
        actions={<Badge tone={statusTone(experiment.status)}>{statusLabel(experiment.status)}</Badge>}
      />

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={envelope.warnings}
        unreachable={envelope.unreachable}
      />

      {study === "strategy_baseline" && summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Excess vs matched hold"
              value={formatPercent(summary.meanExcessVsMatched)}
              hint="Same bars invested, cash elsewhere"
            />
            <StatTile
              label="Portfolio return"
              value={formatPercent(summary.meanStrategyReturn)}
              hint="Equal weight, no rebalancing"
            />
            <StatTile
              label="Matched hold"
              value={formatPercent(summary.meanMatchedBenchmarkReturn)}
              hint="Same bars, no costs"
            />
            <StatTile
              label="Full hold"
              value={formatPercent(summary.meanBenchmarkReturn)}
              hint="Invested the whole period"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Mean trade"
              value={formatPercent(summary.meanTradeReturn)}
              hint="Per round trip, net of costs"
            />
            <StatTile label="Win rate" value={formatShare(summary.winRate)} />
            <StatTile
              label="Trades"
              value={formatCount(summary.tradeCount)}
              hint={`${formatCount(summary.symbolsMeasured)} symbols`}
            />
            <StatTile
              label="Exposure"
              value={formatShare(summary.meanExposure)}
              hint="Share of bars holding a position"
            />
          </div>

          <Panel title="Equity curve">
            <QuantSeriesExplorer series={series} />
          </Panel>

          <Panel title="Portfolio statistics">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
              <Metric
                label="Portfolio return"
                value={formatPercent(summary.meanStrategyReturn)}
                note="Mean of the per-symbol returns, not a sum"
              />
              <Metric
                label="Median symbol"
                value={formatPercent(summary.medianStrategyReturn)}
                note="One symbol can decide the mean"
              />
              <Metric
                label="Matched hold"
                value={formatPercent(summary.meanMatchedBenchmarkReturn)}
                note="Same invested bars, no costs"
              />
              <Metric
                label="Full hold"
                value={formatPercent(summary.meanBenchmarkReturn)}
                note="100% of the period"
              />
              <Metric
                label="Excess vs matched"
                value={formatPercent(summary.meanExcessVsMatched)}
                note="Did the timing add value"
              />
              <Metric
                label="Excess vs full hold"
                value={formatPercent(summary.meanExcessReturn)}
                note="Mostly a measure of exposure"
              />
              <Metric
                label="Cost drag"
                value={formatPercent(summary.costDrag)}
                note="Zero-cost run minus this run"
              />
              <Metric
                label="Cost per trade"
                value={formatPercent(summary.averageCostPerTrade, 2)}
                note="Of that trade's own notional"
              />
              <Metric
                label="95% interval"
                value={
                  summary.tradeReturnInterval
                    ? `${formatPercent(summary.tradeReturnInterval.lower)} to ${formatPercent(
                        summary.tradeReturnInterval.upper,
                      )}`
                    : "—"
                }
                note="Per trade, not per portfolio"
              />
              <Metric
                label="p-value"
                value={formatPValue(summary.tradeReturnSignificance?.pValue)}
                note="Mean trade return against zero"
              />
              <Metric
                label="Family correction"
                value={
                  result?.multipleTesting
                    ? result.multipleTesting.survives
                      ? "Survives"
                      : "Does not survive"
                    : "—"
                }
                note={
                  result?.multipleTesting
                    ? `${result.multipleTesting.tests} rules searched, Bonferroni ${formatPValue(
                        result.multipleTesting.bonferroniAlpha,
                      )}`
                    : "No correction recorded"
                }
              />
              <Metric
                label="Small sample"
                value={summary.smallSample ? "Yes" : "No"}
                note="Under 30 trades is descriptive only"
              />
            </dl>
          </Panel>

          {result?.definitions ? (
            <Panel title="What each figure measures">
              <dl className="flex flex-col gap-3">
                {Object.entries(result.definitions).map(([key, text]) => (
                  <div key={key}>
                    <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                      {key}
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-mk-muted text-pretty">
                      {text}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </>
      ) : null}

      {study === "institutional_holdings_study" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Position changes" value={formatCount(result?.sampleSize)} />
            <StatTile
              label="Mean top weight"
              value={formatPercent(result?.concentration?.meanTopWeight)}
              hint="Largest position share"
            />
            <StatTile
              label="Filings used"
              value={formatCount(
                (result?.coverage as { deduplicatedPositions?: number } | undefined)
                  ?.deduplicatedPositions,
              )}
            />
            <StatTile
              label="Filers"
              value={formatCount(
                (result?.coverage as { institutions?: number } | undefined)?.institutions,
              )}
            />
          </div>

          <Panel title="Forward returns by change type">
            {categories.length === 0 ? (
              <EmptyState
                title="No position change was observed"
                description="No mapped pilot security had a reported change between consecutive quarters."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left">
                  <thead>
                    <tr className="border-b border-mk-line">
                      <th className="pb-2 pr-3 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        Change
                      </th>
                      <th className="pb-2 pr-3 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        Events
                      </th>
                      <th className="pb-2 pr-3 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        Mean fwd
                      </th>
                      <th className="pb-2 pr-3 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        p
                      </th>
                      <th className="pb-2 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <CategoryRow key={category.category} category={category} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-mk-muted text-pretty">
              A reported holdings increase is a change in a quarterly 13F position,
              not a real-time purchase. Forward returns are measured from the next
              session after the filing became public.
            </p>
          </Panel>
        </>
      ) : null}

      {study === "insider_purchase_event_study" ? (
        <Panel title="Data availability">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Purchases found"
              value={formatCount(result?.sampleSize)}
              hint="Open-market, public in window"
            />
            <StatTile
              label="Transactions stored"
              value={formatCount(
                (result?.dataAvailability as { insiderTransactionsStored?: number } | undefined)
                  ?.insiderTransactionsStored,
              )}
            />
            <StatTile
              label="Filings stored"
              value={formatCount(
                (result?.dataAvailability as { filingsStored?: number } | undefined)?.filingsStored,
              )}
            />
            <StatTile label="Status" value={statusLabel(experiment.status)} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-mk-muted text-pretty">
            The study reports the exact count rather than a statistic computed from
            nothing. SEC ingestion is gated on a real operator contact address, so
            no insider filings have been collected yet.
          </p>
        </Panel>
      ) : null}

      {flags.length > 0 ? (
        <Panel title="Warnings">
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li key={flag} className="text-sm leading-relaxed text-mk-muted text-pretty">
                {flag}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {limitations.length > 0 ? (
        <Panel title="Limitations">
          <ul className="flex flex-col gap-2">
            {limitations.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-mk-muted text-pretty">
                {item}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Reproducibility">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Definition hash
            </dt>
            <dd className="mt-0.5 truncate font-marketing-mono text-[11px] text-mk-muted">
              {experiment.definitionHash}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Data fingerprint
            </dt>
            <dd className="mt-0.5 truncate font-marketing-mono text-[11px] text-mk-muted">
              {experiment.dataFingerprint}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Information cutoff
            </dt>
            <dd className="mt-0.5 font-marketing-mono text-[11px] text-mk-muted">
              {experiment.informationCutoff?.slice(0, 19).replace("T", " ") ?? "—"} UTC
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Recorded
            </dt>
            <dd className="mt-0.5 font-marketing-mono text-[11px] text-mk-muted">
              {experiment.createdAt?.slice(0, 19).replace("T", " ") ?? "—"} UTC
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-mk-dim text-pretty">
          Re-running an unchanged definition returns this stored result rather than
          recording a second one. If the underlying data changes, the run is flagged
          instead of overwriting the published number.
        </p>
      </Panel>
    </div>
  );
}
