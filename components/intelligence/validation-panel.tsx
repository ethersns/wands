import { Sigma } from "lucide-react";

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
import type { IntelValidation } from "@/lib/api/contracts";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  readHorizons,
  readSplits,
  validationStatus,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

function signedPercent(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return formatPercent(value * 100, { digits, signed: true });
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The measured validation for one signal category.
 *
 * When the engine reports that it could not measure the category, the status
 * and flags are shown and no statistic is invented to fill the space.
 */
export function ValidationPanel({ validation }: { validation: IntelValidation }) {
  const status = validationStatus(validation.status);
  const horizons = readHorizons({ horizons: validation.horizons });
  const splits = readSplits({ splits: validation.splits });
  const measured = horizons.some((row) => row.sampleSize > 0 && row.mean !== null);

  const overlapPairs = readNumber(validation.overlap, "overlappingPairs");
  const overlapShare = readNumber(validation.overlap, "overlapShare");
  const testsRun = validation.multipleTesting
    ? readNumber(validation.multipleTesting, "tests")
    : null;
  const adjustedAlpha = validation.multipleTesting
    ? readNumber(validation.multipleTesting, "adjustedAlpha")
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip label={status.label} tone={status.tone} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {validation.category}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          benchmark {validation.benchmark || "—"} · cost{" "}
          {formatNumber(validation.costBps, { digits: 1 })} bps
        </span>
      </div>

      {validation.flags.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {validation.flags.map((flag) => (
            <CoverageWarning key={flag} severity="warning" title={flag} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <KeyValueList
          items={[
            {
              label: "Sample size",
              value: formatNumber(validation.sampleSize, { digits: 0 }),
            },
            { label: "Horizons measured", value: horizons.length },
            {
              label: "Overlapping pairs",
              value: overlapPairs === null ? "—" : formatNumber(overlapPairs, { digits: 0 }),
            },
            {
              label: "Overlap share",
              value:
                overlapShare === null
                  ? "—"
                  : formatPercent(overlapShare * 100, { digits: 1 }),
            },
          ]}
        />
        <KeyValueList
          items={[
            {
              label: "Tests run",
              value: testsRun === null ? "—" : formatNumber(testsRun, { digits: 0 }),
            },
            {
              label: "Adjusted alpha",
              value: adjustedAlpha === null ? "—" : adjustedAlpha.toFixed(4),
            },
            { label: "Splits", value: splits.length },
            { label: "Signal", value: validation.signalId.slice(0, 8) },
          ]}
        />
      </div>

      {measured ? (
        <div className="flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
            <Sigma className="size-3 text-muted-foreground" aria-hidden />
            Mean forward return by horizon
          </h4>
          <HorizonChart rows={horizons} height={200} />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Horizon</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
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
          severity="blocking"
          title="This category could not be measured"
        >
          The engine reported <span className="font-mono">{validation.status}</span> and
          supplied no forward-return statistic. No chart is drawn, because an empty axis
          would read as a zero return.
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
  );
}
