import { FlaskConical, Sigma } from "lucide-react";

import { CoverageWarning } from "./coverage-warning";
import { HorizonChart } from "./horizon-chart";
import { KeyValueList } from "./evidence-panel";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IntelExperiment } from "@/lib/api/contracts";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import {
  claimType,
  experimentStatus,
  hasMeasuredHorizons,
  readHorizons,
  readSplits,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

function signedPercent(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return formatPercent(value * 100, { digits, signed: true });
}

/**
 * One experiment's result.
 *
 * The claim type is stated before any number: a descriptive event study, a
 * hypothetical simulation and a realised account result are three different
 * things, and only the first two can come out of this engine.
 */
export function ExperimentResultCard({
  experiment,
  className,
}: {
  experiment: IntelExperiment;
  className?: string;
}) {
  const status = experimentStatus(experiment.status);
  const claim = claimType(experiment);
  const horizons = readHorizons(experiment.metrics);
  const splits = readSplits(experiment.metrics);
  const measured = hasMeasuredHorizons(experiment.metrics);
  const costBps = experiment.metrics.costBps;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-medium text-foreground">{experiment.name}</h3>
            <StatusChip label={status.label} tone={status.tone} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span>{experiment.signalVersion}</span>
            <span aria-hidden>·</span>
            <span>{experiment.dataVersion}</span>
            <span aria-hidden>·</span>
            <span>
              {formatDate(experiment.periodStart)} → {formatDate(experiment.periodEnd)}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-[0.04em] text-foreground uppercase">
            <FlaskConical className="size-2.5" aria-hidden />
            {claim.label}
          </span>
          <span className="text-[10px] text-muted-foreground">
            not realised account performance
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <p className="text-[11px] leading-relaxed text-pretty text-muted-foreground">
          {claim.detail}
        </p>

        {experiment.flags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {experiment.flags.map((flag) => (
              <CoverageWarning key={flag} severity="warning" title={flag} />
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <KeyValueList
            items={[
              { label: "Sample size", value: formatNumber(experiment.sampleSize, { digits: 0 }) },
              { label: "Benchmark", value: experiment.benchmark || "—" },
              {
                label: "Cost assumption",
                value:
                  typeof costBps === "number"
                    ? `${formatNumber(costBps, { digits: 1 })} bps`
                    : "none stated",
              },
              { label: "Information cutoff", value: formatDateTime(experiment.informationCutoff) },
            ]}
          />
          <KeyValueList
            items={[
              { label: "Definition hash", value: experiment.definitionHash.slice(0, 16) },
              { label: "Data fingerprint", value: experiment.dataFingerprint.slice(0, 16) },
              { label: "Created", value: formatDateTime(experiment.createdAt) },
              { label: "Completed", value: formatDateTime(experiment.completedAt) },
            ]}
          />
        </div>

        {measured ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Sigma className="size-3 text-muted-foreground" aria-hidden />
                Mean forward return by horizon
              </h4>
              <span className="text-[10px] text-muted-foreground">
                bars are means, whiskers are the engine&rsquo;s interval
              </span>
            </div>
            <HorizonChart rows={horizons} />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Horizon</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">Mean</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Median</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Hit rate</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Interval</TableHead>
                    <TableHead className="hidden text-right md:table-cell">p</TableHead>
                    <TableHead className="text-right">Excess</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {horizons.map((row) => (
                    <TableRow key={row.horizonDays}>
                      <TableCell className="font-mono text-[11px] text-foreground">
                        {row.horizonDays}d
                        {row.smallSample ? (
                          <span className="ml-1.5 rounded border border-warning/30 bg-warning/10 px-1 py-0.5 text-[9px] tracking-[0.04em] text-warning uppercase">
                            small
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                        {row.sampleSize}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-[11px] tabular",
                          row.mean === null
                            ? "text-muted-foreground"
                            : row.mean >= 0
                              ? "text-profit"
                              : "text-loss",
                        )}
                      >
                        {signedPercent(row.mean)}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground sm:table-cell">
                        {signedPercent(row.median)}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground sm:table-cell">
                        {row.hitRate === null
                          ? "—"
                          : formatPercent(row.hitRate * 100, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground md:table-cell">
                        {row.intervalLower === null || row.intervalUpper === null
                          ? "—"
                          : `${signedPercent(row.intervalLower, 1)} … ${signedPercent(row.intervalUpper, 1)}`}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground md:table-cell">
                        {row.pValue === null ? "—" : row.pValue.toFixed(3)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-[11px] tabular",
                          row.excessMean === null
                            ? "text-muted-foreground"
                            : row.excessMean >= 0
                              ? "text-profit"
                              : "text-loss",
                        )}
                      >
                        {signedPercent(row.excessMean)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <CoverageWarning
            severity={experiment.status === "complete" ? "warning" : "blocking"}
            title={
              experiment.status === "no_price_data"
                ? "No historical prices for this sample"
                : experiment.status === "insufficient_data"
                  ? "Not enough eligible events to measure"
                  : "No measurable horizon in this result"
            }
          >
            The engine reported <span className="font-mono">{experiment.status}</span> and
            supplied no forward-return statistic. No chart is drawn, because an empty
            axis would read as a zero return.
          </CoverageWarning>
        )}

        {splits.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-[11px] font-medium text-foreground">
              In-sample versus out-of-sample
            </h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Split</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">Mean</TableHead>
                    <TableHead className="text-right">Hit rate</TableHead>
                    <TableHead className="text-right">Excess</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {splits.map((split) => (
                    <TableRow key={split.label}>
                      <TableCell className="text-[11px] text-foreground">
                        {split.label}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                        {split.sampleSize}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                        {signedPercent(split.mean)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                        {split.hitRate === null
                          ? "—"
                          : formatPercent(split.hitRate * 100, { digits: 0 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                        {signedPercent(split.excessMean)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
