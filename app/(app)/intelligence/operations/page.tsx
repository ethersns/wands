import type { Metadata } from "next";
import { Cog, ShieldCheck, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { OperationsConsole } from "@/components/intelligence/operations-console";
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
import { getIntelCoverage, getIntelJobs } from "@/lib/api/endpoints";
import { formatDateTime, formatNumber } from "@/lib/format";
import { backfillStatus } from "@/lib/intelligence/presentation";

export const metadata: Metadata = {
  title: "Intelligence Operations",
};

export default async function IntelligenceOperationsPage() {
  const [jobs, coverage] = await Promise.all([getIntelJobs(), getIntelCoverage()]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ProvenanceBadge provenance={jobs.provenance} />
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <Sparkles className="size-2.5" aria-hidden />
              Research only
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <ShieldCheck className="size-2.5" aria-hidden />
              Admin actions
            </span>
          </>
        }
        title="Intelligence Operations"
        description="The collectors that produce the research, and the bounded actions that can change them. Every action is authorised and audited by the engine; this page cannot grant itself a role."
      />

      <UnavailablePanel envelope={jobs} title="Collection jobs are not available" />

      <OperationsConsole
        jobs={jobs.data.items}
        schedulerEnabled={jobs.data.schedulerEnabled}
        caveats={jobs.data.caveats}
      />

      <SectionCard
        title="Backfill checkpoints"
        description="Where each per-issuer stream stopped. A null cursor means the stream has stored nothing yet, not that it is finished."
        bodyClassName="p-0"
        footer={
          <ProvenanceLabel
            provenance={coverage.provenance}
            source={coverage.source}
            generatedAt={coverage.generatedAt}
          />
        }
      >
        {coverage.data.backfill.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No backfill stream is stored. Nothing has been backfilled, which is
              different from a backfill that completed with no new filings.
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
                  <TableHead className="hidden text-right md:table-cell">Attempts</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Window</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Cursor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.data.backfill.map((stream) => {
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
                        {formatNumber(stream.attempts, { digits: 0 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                        {formatNumber(stream.filingsNew, { digits: 0 })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground lg:table-cell">
                        {stream.windowStart && stream.windowEnd
                          ? `${formatDateTime(stream.windowStart)} → ${formatDateTime(stream.windowEnd)}`
                          : "not set"}
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

      <SectionCard
        title="What this page cannot do"
        description="The research terminal is deliberately separated from execution."
      >
        <ul className="flex flex-col gap-1.5">
          {[
            "Place, amend or cancel an order",
            "Reach a broker or exchange credential",
            "Change a risk limit, circuit breaker or execution cap",
            "Enable live trading or route a signal to a bot",
            "Start an unbounded SEC crawl — every backfill is capped by a filing limit",
          ].map((rule) => (
            <li key={rule} className="flex items-start gap-2">
              <Cog
                className="mt-0.5 size-3 shrink-0 text-muted-foreground/70"
                aria-hidden
              />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {rule}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {jobs.data.caveats.length > 0 ? (
        <CoverageWarning severity="info" title="Engine caveats">
          <ul className="flex flex-col gap-1">
            {jobs.data.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </CoverageWarning>
      ) : null}
    </div>
  );
}
