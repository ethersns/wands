import type { Metadata } from "next";
import {
  CalendarRange,
  Database,
  FileWarning,
  Fingerprint,
  LineChart,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { MetricTile } from "@/components/intelligence/metric-tile";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { SourceFreshnessTable } from "@/components/intelligence/source-freshness";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { KeyValueList } from "@/components/intelligence/evidence-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getIntelCoverage, getIntelStatus } from "@/lib/api/endpoints";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import {
  backfillStatus,
  coverageGaps,
  readIdentifierCoverage,
  readPriceCoverage,
  researchReadiness,
} from "@/lib/intelligence/presentation";
import { toneText } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Data Coverage",
};

export default async function DataCoveragePage() {
  const [coverage, status] = await Promise.all([getIntelCoverage(), getIntelStatus()]);

  const c = coverage.data;
  const identifiers = readIdentifierCoverage(c.identifiers);
  const prices = readPriceCoverage(c.priceCoverage);
  const gaps = coverageGaps(c);
  const readiness = researchReadiness(c);

  const malformed = c.backfill.reduce((total, s) => total + s.filingsMalformed, 0);
  const unavailable = c.backfill.reduce((total, s) => total + s.filingsUnavailable, 0);
  const parsed = c.backfill.reduce((total, s) => total + s.filingsNew, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={coverage.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator
              freshness={status.data.freshness}
              lastSuccessAt={status.data.latestFilingAt}
            />
          </>
        }
        title="Data Coverage"
        description="Whether Wands holds enough information to evaluate a trading hypothesis. Coverage is reported as counts, not a single percentage, because a percentage hides whether the missing part is one obscure issuer or the whole market."
      />

      <UnavailablePanel envelope={coverage} title="Coverage data is not available" />

      <div
        className={cn(
          "flex flex-col gap-1 rounded-xl border px-4 py-3",
          readiness.tone === "profit"
            ? "border-profit/30 bg-profit/[0.06]"
            : readiness.tone === "primary"
              ? "border-warning/30 bg-warning/[0.06]"
              : "border-loss/30 bg-loss/[0.06]",
        )}
      >
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
          <Database
            className={cn("size-3.5 shrink-0", toneText[readiness.tone])}
            aria-hidden
          />
          {readiness.verdict}
        </p>
        <p className="text-[11px] leading-relaxed text-pretty text-muted-foreground">
          {readiness.detail}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile
          label="Filings"
          value={formatNumber(c.filings, { digits: 0 })}
          hint="Documents stored"
          icon={Database}
          tone="primary"
        />
        <MetricTile
          label="Transactions"
          value={formatNumber(c.transactions, { digits: 0 })}
          hint="Parsed lines"
          icon={Database}
          tone="primary"
        />
        <MetricTile
          label="Signals"
          value={formatNumber(c.signals, { digits: 0 })}
          hint="Thresholds met"
          icon={Sparkles}
          tone="profit"
        />
        <MetricTile
          label="Institutions"
          value={formatNumber(c.institutions, { digits: 0 })}
          hint="13F filers"
          icon={Database}
          tone="muted"
        />
        <MetricTile
          label="Holdings"
          value={formatNumber(c.holdings, { digits: 0 })}
          hint="Position lines"
          icon={Database}
          tone="muted"
        />
        <MetricTile
          label="Symbols"
          value={formatNumber(c.symbolsCovered.length, { digits: 0 })}
          hint="With research"
          icon={Database}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Filing date coverage"
          description="The span of history actually stored, not the span requested."
        >
          <KeyValueList
            items={[
              {
                label: "Earliest filing",
                value: c.earliestFilingAt ? formatDate(c.earliestFilingAt) : "none",
              },
              {
                label: "Latest filing",
                value: c.latestFilingAt ? formatDate(c.latestFilingAt) : "none",
              },
              {
                label: "Earliest signal",
                value: c.earliestSignalAt ? formatDate(c.earliestSignalAt) : "none",
              },
              {
                label: "Latest signal",
                value: c.latestSignalAt ? formatDate(c.latestSignalAt) : "none",
              },
            ]}
          />
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <CalendarRange
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              A short span limits what a backtest can claim. A result measured over a few
              weeks is a description of those weeks, not an estimate of future behaviour.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Parsed versus unavailable filings"
          description="Every filing the collectors saw, and what happened to it."
        >
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-border bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                Parsed
              </p>
              <p className="mt-0.5 font-mono text-[16px] tabular text-profit">
                {formatNumber(parsed, { digits: 0 })}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                Unavailable
              </p>
              <p className="mt-0.5 font-mono text-[16px] tabular text-warning">
                {formatNumber(unavailable, { digits: 0 })}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                Malformed
              </p>
              <p className="mt-0.5 font-mono text-[16px] tabular text-loss">
                {formatNumber(malformed, { digits: 0 })}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
            &ldquo;Unavailable&rdquo; means the SEC index listed the document but the
            request failed. &ldquo;Malformed&rdquo; means it was fetched but could not be
            parsed. Both are missing from every count on this page, and neither is
            evidence that the filing was empty.
          </p>
        </SectionCard>
      </div>

      <SectionCard
        title="Identifier resolution"
        description="13F holdings are keyed by CUSIP. A CUSIP without a verified mapping cannot be attributed to a symbol."
        bodyClassName="p-0"
        footer={
          <ProvenanceLabel
            provenance={coverage.provenance}
            source={coverage.source}
            generatedAt={coverage.generatedAt}
          />
        }
      >
        <div className="grid gap-4 px-4 py-3 sm:px-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5">
              <MetricTile
                label="Distinct CUSIPs"
                value={formatNumber(identifiers.distinctCusips, { digits: 0 })}
                hint="In stored holdings"
                icon={Fingerprint}
                tone="muted"
              />
              <MetricTile
                label="Verified"
                value={formatNumber(identifiers.verifiedCusips, { digits: 0 })}
                hint={
                  identifiers.resolvedPct === null
                    ? "no CUSIPs stored"
                    : `${formatPercent(identifiers.resolvedPct, { digits: 1 })} resolved`
                }
                icon={Fingerprint}
                tone={identifiers.unresolvedCusips > 0 ? "warning" : "profit"}
              />
            </div>
            <KeyValueList
              items={[
                { label: "Mappings stored", value: formatNumber(identifiers.mappings, { digits: 0 }) },
                {
                  label: "Unresolved CUSIPs",
                  value: formatNumber(identifiers.unresolvedCusips, { digits: 0 }),
                },
                {
                  label: "Fusion eligible",
                  value: formatNumber(identifiers.fusionEligible, { digits: 0 }),
                },
                {
                  label: "Mapping sources",
                  value: identifiers.sources.length > 0 ? identifiers.sources.join(", ") : "none",
                },
              ]}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              By verification status
            </p>
            {identifiers.byStatus.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No identifier mappings are stored. Every 13F holding is therefore
                unattributed, and the institutional component is omitted from symbol
                rankings rather than approximated.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {identifiers.byStatus.map((entry) => (
                  <li
                    key={entry.status}
                    className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0"
                  >
                    <span className="font-mono text-[11px] text-foreground">
                      {entry.status}
                    </span>
                    <span className="font-mono text-[11px] tabular text-muted-foreground">
                      {formatNumber(entry.count, { digits: 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {identifiers.unresolvedCusips > 0 ? (
              <CoverageWarning
                severity="warning"
                title={`${identifiers.unresolvedCusips} CUSIP${identifiers.unresolvedCusips === 1 ? "" : "s"} unresolved`}
              >
                These holdings are listed by CUSIP only. No symbol-level attribution is
                shown for them, because the engine supplies no verified mapping.
              </CoverageWarning>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Market-price coverage"
        description="A symbol without daily bars cannot be validated. Its signals count toward the sample but produce no return."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <KeyValueList
            items={[
              {
                label: "Symbols with signals",
                value: formatNumber(prices.symbolsWithSignals, { digits: 0 }),
              },
              {
                label: "Symbols with daily bars",
                value: formatNumber(prices.symbolsWithDailyBars, { digits: 0 }),
              },
              {
                label: "Coverage",
                value:
                  prices.coveredPct === null
                    ? "—"
                    : formatPercent(prices.coveredPct, { digits: 1 }),
              },
              { label: "Missing", value: formatNumber(prices.missing.length, { digits: 0 }) },
            ]}
          />
          <div className="flex flex-col gap-2">
            {prices.note ? (
              <p className="text-[11px] leading-relaxed text-pretty text-muted-foreground">
                {prices.note}
              </p>
            ) : null}
            {prices.missing.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {prices.missing.slice(0, 40).map((ticker) => (
                  <span
                    key={ticker}
                    className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning"
                  >
                    {ticker}
                  </span>
                ))}
                {prices.missing.length > 40 ? (
                  <span className="px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    +{prices.missing.length - 40} more
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <LineChart className="size-3" aria-hidden />
                Every symbol with a signal has daily bars.
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Backfill progress"
        description="Per-issuer streams, with the checkpoint each one reached."
        bodyClassName="p-0"
      >
        {c.backfill.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No backfill stream is stored. Collection has only run from the scheduler, or
              no bounded backfill has been started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Issuer CIK</TableHead>
                  <TableHead className="hidden sm:table-cell">Form</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Seen</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Skipped</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">
                    Unavailable
                  </TableHead>
                  <TableHead className="hidden text-right xl:table-cell">
                    Malformed
                  </TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Cursor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.backfill.map((stream) => {
                  const state = backfillStatus(stream.status);
                  return (
                    <TableRow key={`${stream.issuerCik}-${stream.formFamily}`}>
                      <TableCell className="font-mono text-[11px] text-foreground">
                        {stream.issuerCik}
                      </TableCell>
                      <TableCell className="hidden font-mono text-[10px] text-muted-foreground sm:table-cell">
                        {stream.formFamily}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={state.label} tone={state.tone} />
                        {stream.lastError ? (
                          <p className="mt-1 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
                            {stream.lastError}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground md:table-cell">
                        {formatNumber(stream.filingsSeen, { digits: 0 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                        {formatNumber(stream.filingsNew, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground lg:table-cell">
                        {formatNumber(stream.filingsSkipped, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-warning lg:table-cell">
                        {formatNumber(stream.filingsUnavailable, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-loss xl:table-cell">
                        {formatNumber(stream.filingsMalformed, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground xl:table-cell">
                        {stream.cursor ? formatDateTime(stream.cursor) : "not started"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Coverage gaps"
          description="Ordered worst first. A blocking gap means no hypothesis can be evaluated yet."
        >
          {gaps.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No coverage gap was detected in the stored data. That says the data is
              present, not that a signal is profitable.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {gaps.map((gap) => (
                <li key={gap.label}>
                  <CoverageWarning
                    severity={gap.severity === "blocking" ? "blocking" : gap.severity}
                    title={gap.label}
                  >
                    {gap.detail}
                  </CoverageWarning>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Source reliability"
          description="Per-collector freshness, derived from completed runs."
        >
          <SourceFreshnessTable sources={status.data.sources} />
        </SectionCard>
      </div>

      {c.caveats.length > 0 ? (
        <SectionCard
          title="Engine caveats"
          description="Reported with this payload, unedited."
        >
          <ul className="flex flex-col gap-1.5">
            {c.caveats.map((item) => (
              <li key={item}>
                <CoverageWarning severity="info" title={item} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <FileWarning
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Coverage describes what is stored. It does not describe what exists: a filing
          that was never collected is invisible here, and its absence is not evidence
          that the event did not happen.
        </p>
      </div>
    </div>
  );
}
