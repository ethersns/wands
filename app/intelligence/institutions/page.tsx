import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Landmark, Sparkles, Tag } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { FilingSourceLink } from "@/components/intelligence/filing-link";
import { FreshnessIndicator } from "@/components/intelligence/freshness-indicator";
import { MetricTile } from "@/components/intelligence/metric-tile";
import { Pagination } from "@/components/intelligence/pagination";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getInstitutionChanges,
  getInstitutions,
  getIntelStatus,
} from "@/lib/api/endpoints";
import type { InstitutionalChangeType } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { freshnessCaveat } from "@/lib/intelligence/presentation";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Institutional Radar",
};

const PAGE_LIMIT = 30;

const CHANGE_TONE: Record<InstitutionalChangeType, StatusTone> = {
  new: "profit",
  increased: "profit",
  decreased: "loss",
  exited: "loss",
  unchanged: "muted",
};

const CHANGE_LABEL: Record<InstitutionalChangeType, string> = {
  new: "New",
  increased: "Increased",
  decreased: "Decreased",
  exited: "Exited",
  unchanged: "Unchanged",
};

export default async function InstitutionalRadarPage({
  searchParams,
}: {
  searchParams: Promise<{ cik?: string; page?: string }>;
}) {
  const params = await searchParams;
  const cik = (params.cik ?? "").trim();
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [status, feed, changes] = await Promise.all([
    getIntelStatus(),
    getInstitutions(page, PAGE_LIMIT),
    cik ? getInstitutionChanges(cik) : Promise.resolve(null),
  ]);

  const s = status.data;
  const caveat = freshnessCaveat(s.freshness);
  const selected = feed.data.items.find((item) => item.cik === cik);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={feed.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
            <FreshnessIndicator freshness={s.freshness} lastSuccessAt={s.latestFilingAt} />
          </>
        }
        title="Institutional Radar"
        description="Historical 13F holdings disclosures. A 13F is a quarterly snapshot filed up to 45 days after quarter end — it is not a current position and it is not a real-time institutional purchase."
      />

      <CoverageWarning severity="warning" title="A 13F is a quarterly snapshot, not a live position">
        The reported value is what the institution held at the period end shown on each
        row. Between that date and the public filing date the position may have changed
        entirely, and the filing itself may be amended.
      </CoverageWarning>

      <UnavailablePanel envelope={feed} title="Institutional filings are not available" />

      {caveat ? (
        <CoverageWarning
          severity={s.freshness === "failing" ? "blocking" : "warning"}
          title={`Feed is ${s.freshness}`}
        >
          {caveat}
        </CoverageWarning>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MetricTile
          label="Institutions"
          value={formatNumber(s.institutions, { digits: 0 })}
          hint="13F filers stored"
          icon={Landmark}
          tone="primary"
        />
        <MetricTile
          label="Holdings"
          value={formatNumber(s.holdings, { digits: 0 })}
          hint="Quarterly position lines"
          icon={Building2}
          tone="muted"
        />
        <MetricTile
          label="On this page"
          value={formatNumber(feed.data.items.length, { digits: 0 })}
          hint={`of ${feed.data.total} filers`}
          icon={Building2}
          tone="muted"
        />
        <MetricTile
          label="Latest filing"
          value={s.latestFilingAt ? formatDate(s.latestFilingAt) : "never"}
          hint="Most recent stored document"
          icon={Landmark}
          tone="muted"
        />
      </div>

      <SectionCard
        title="Institutions"
        description="Select a filer to read its quarter-over-quarter holdings changes."
        bodyClassName="p-0"
        footer={
          <ProvenanceLabel
            provenance={feed.provenance}
            source={feed.source}
            generatedAt={feed.generatedAt}
          />
        }
      >
        {feed.data.items.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Landmark}
              title="No 13F filings stored"
              description="Institutional data is empty because nothing has been collected, not because no institution filed."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Institution</TableHead>
                  <TableHead className="hidden sm:table-cell">Latest period</TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Reported value
                  </TableHead>
                  <TableHead className="text-right">Positions</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">
                    Public
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feed.data.items.map((institution) => {
                  const active = institution.cik === cik;
                  return (
                    <TableRow
                      key={institution.cik}
                      className={cn(active && "bg-accent/40")}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="max-w-64 truncate text-[11px] font-medium text-foreground">
                            {institution.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            CIK {institution.cik}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-[11px] tabular text-muted-foreground sm:table-cell">
                        {institution.latestPeriod
                          ? formatDate(institution.latestPeriod)
                          : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-foreground md:table-cell">
                        {institution.reportedValueUsd === null
                          ? "—"
                          : formatCurrency(institution.reportedValueUsd, "USD", {
                              compact: true,
                            })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                        {formatNumber(institution.positionCount, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground lg:table-cell">
                        {formatDateTime(institution.latestPublicAvailableAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/intelligence/institutions?cik=${encodeURIComponent(institution.cik)}`}
                          aria-current={active ? "true" : undefined}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {active ? "Selected" : "Changes"}
                          <span className="sr-only"> for {institution.name}</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Pagination
          basePath="/intelligence/institutions"
          params={{ cik }}
          page={feed.data.page}
          limit={feed.data.limit}
          total={feed.data.total}
          hasMore={feed.data.hasMore}
        />
      </SectionCard>

      {changes ? (
        <SectionCard
          title={`${changes.data.name || selected?.name || cik} — holdings changes`}
          description={
            changes.data.periodOfReport
              ? `Period ${formatDate(changes.data.periodOfReport)}${
                  changes.data.priorPeriodOfReport
                    ? ` versus ${formatDate(changes.data.priorPeriodOfReport)}`
                    : " (no prior period stored)"
                }`
              : "No reporting period is stored for this filer."
          }
          bodyClassName="p-0"
          footer={
            <ProvenanceLabel
              provenance={changes.provenance}
              source={changes.source}
              generatedAt={changes.generatedAt}
            />
          }
        >
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <Tag className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  Holdings are keyed by CUSIP, not by ticker
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-pretty text-muted-foreground">
                  The engine supplies no verified CUSIP-to-symbol mapping, so no
                  symbol-level attribution is shown. A holding whose identifier is
                  unresolved is listed by CUSIP and omitted from any symbol ranking
                  rather than approximated.
                </p>
              </div>
            </div>
          </div>

          {changes.data.changes.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5">
              <EmptyState
                icon={Building2}
                title="No holdings stored for this filer"
                description="No 13F position lines are stored, so no quarter-over-quarter change can be calculated. This is an absence of data, not a flat position."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Issuer / security</TableHead>
                    <TableHead className="hidden sm:table-cell">CUSIP</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Current
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">Prior</TableHead>
                    <TableHead className="text-right">Δ shares</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Δ %</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">
                      Public
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Source</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.data.changes.map((change) => (
                    <TableRow key={`${change.cusip}-${change.periodOfReport}`}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="max-w-56 truncate text-[11px] text-foreground">
                            {change.issuerName || "Unnamed issuer"}
                          </span>
                          <span className="max-w-56 truncate text-[10px] text-muted-foreground">
                            {change.classTitle || "Class not reported"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-[10px] text-muted-foreground sm:table-cell">
                        {change.cusip}
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          label={CHANGE_LABEL[change.changeType]}
                          tone={CHANGE_TONE[change.changeType]}
                        />
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-foreground md:table-cell">
                        {formatNumber(change.currentShares, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground md:table-cell">
                        {formatNumber(change.priorShares, { digits: 0 })}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-[11px] tabular",
                          change.shareChange === null
                            ? "text-muted-foreground"
                            : change.shareChange >= 0
                              ? "text-profit"
                              : "text-loss",
                        )}
                      >
                        {change.shareChange === null
                          ? "—"
                          : `${change.shareChange > 0 ? "+" : ""}${formatNumber(change.shareChange, { digits: 0 })}`}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground lg:table-cell">
                        {change.shareChangePct === null
                          ? "—"
                          : formatPercent(change.shareChangePct, { digits: 1, signed: true })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-foreground sm:table-cell">
                        {change.currentValueUsd === null
                          ? "—"
                          : formatCurrency(change.currentValueUsd, "USD", {
                              compact: true,
                            })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground xl:table-cell">
                        {formatDateTime(change.publicAvailableAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <FilingSourceLink href={change.sourceUrl} compact />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {changes.data.caveats.length > 0 ? (
            <ul className="flex flex-col gap-1.5 px-4 pb-4 sm:px-5">
              {changes.data.caveats.map((item) => (
                <li key={item}>
                  <CoverageWarning severity="info" title={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
