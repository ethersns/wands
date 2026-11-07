import type { Metadata } from "next";
import Link from "next/link";

import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  ProvenanceNote,
  StatTile,
} from "@/components/member/ui";
import {
  formatCount,
  headline,
  periodLabel,
  statusLabel,
  statusTone,
  studyLabel,
} from "@/lib/member/quant";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Quant Lab",
  description:
    "Reproducible research experiments over real market data, with coverage and limitations stated next to every result.",
};

export default async function QuantLabPage() {
  await requireMember("/app/quant-lab");

  const feed = await memberResearch.experiments();
  const experiments = feed.data.items;

  const measured = experiments.filter((item) => item.status === "complete").length;
  const insufficient = experiments.filter(
    (item) => item.status === "insufficient_data",
  ).length;
  const observations = experiments.reduce(
    (total, item) => total + (item.metrics?.sampleSize ?? item.sampleSize),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Quant Lab"
        title="Evidence, not conviction"
        description="Each experiment states what it measured, over which period, on how many observations, and what it could not measure. A study that found nothing is reported as a study that found nothing."
      />

      <ProvenanceNote
        provenance={feed.provenance}
        generatedAt={feed.generatedAt}
        warnings={feed.warnings}
        unreachable={feed.unreachable}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Experiments" value={formatCount(experiments.length)} />
        <StatTile label="Measured" value={formatCount(measured)} hint="Cleared the minimum sample" />
        <StatTile
          label="Insufficient"
          value={formatCount(insufficient)}
          hint="Reported, not hidden"
        />
        <StatTile label="Observations" value={formatCount(observations)} />
      </div>

      <Panel title="Recorded experiments">
        {experiments.length === 0 ? (
          <EmptyState
            title="No experiment has been recorded"
            description="An experiment is created by an operator run over a defined period. Nothing here is generated on read, so an empty list means no study has been executed yet."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-mk-line">
            {experiments.map((experiment) => {
              const metric = headline(experiment);
              return (
                <li key={experiment.id}>
                  <Link
                    href={`/app/quant-lab/${experiment.id}`}
                    className="group flex flex-col gap-3 py-4 transition-colors first:pt-0 last:pb-0 hover:bg-mk-raised/40 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
                          {studyLabel(experiment.metrics?.study)}
                        </span>
                        <Badge tone={statusTone(experiment.status)}>
                          {statusLabel(experiment.status)}
                        </Badge>
                      </div>
                      <p className="mt-1.5 font-display text-base font-medium tracking-[-0.01em] text-mk-fg group-hover:text-mk-accent">
                        {experiment.name}
                      </p>
                      <p className="mt-1 font-marketing-mono text-[11px] tabular-nums text-mk-muted">
                        {periodLabel(experiment)} · {formatCount(experiment.sampleSize)} obs
                      </p>
                    </div>

                    <div className="shrink-0 sm:text-right">
                      <p className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
                        {metric.label}
                      </p>
                      <p className="mt-0.5 font-display text-lg font-semibold tabular-nums tracking-[-0.02em] text-mk-fg">
                        {metric.value}
                      </p>
                      <p className="mt-0.5 max-w-[22rem] text-[11px] leading-relaxed text-mk-muted">
                        {metric.hint}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="max-w-3xl text-xs leading-relaxed text-mk-dim text-pretty">
        Every figure on this page is a hypothetical research result computed from
        stored historical data. None of it is realised account performance, and
        none of it is an instruction to trade. Live trading remains disabled.
      </p>
    </div>
  );
}
