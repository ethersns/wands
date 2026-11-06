import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, LineChart, Sigma, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { CoverageWarning } from "@/components/intelligence/coverage-warning";
import { ExperimentResultCard } from "@/components/intelligence/experiment-card";
import { ProvenanceLabel } from "@/components/intelligence/provenance-label";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import { ValidationPanel } from "@/components/intelligence/validation-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getIntelExperiment,
  getIntelExperiments,
  getSignalValidation,
} from "@/lib/api/endpoints";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { experimentStatus } from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Research Performance",
};

const CLAIM_TYPES = [
  {
    label: "Descriptive event study",
    detail:
      "What happened to the price after each event, measured on stored daily bars. No fills, no costs, no account.",
    tone: "border-border bg-muted/40",
  },
  {
    label: "Hypothetical simulation",
    detail:
      "The same events with modelled entries and estimated trading costs. Still not an account result.",
    tone: "border-border bg-muted/40",
  },
  {
    label: "Realised account performance",
    detail:
      "Not produced by this engine. No figure on this page is a realised return on any account.",
    tone: "border-loss/30 bg-loss/[0.06]",
  },
];

export default async function ResearchPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; signal?: string }>;
}) {
  const params = await searchParams;
  const id = (params.id ?? "").trim();
  const signalId = (params.signal ?? "").trim();

  const [feed, validation] = await Promise.all([
    getIntelExperiments(25),
    signalId ? getSignalValidation(signalId) : Promise.resolve(null),
  ]);

  const selectedId = id || feed.data.items[0]?.id || "";
  const detail = selectedId ? await getIntelExperiment(selectedId) : null;
  const experiment = detail?.data ?? null;

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
          </>
        }
        title="Research Performance"
        description="Measured results for the signal engine, with the sample, the costs and the limitations that produced them. A result here is evidence about a hypothesis — it is not a track record."
      />

      <div className="grid gap-2.5 sm:grid-cols-3">
        {CLAIM_TYPES.map((claim) => (
          <div
            key={claim.label}
            className={cn("rounded-lg border px-3 py-2.5", claim.tone)}
          >
            <p className="text-[11px] font-medium text-foreground">{claim.label}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-pretty text-muted-foreground">
              {claim.detail}
            </p>
          </div>
        ))}
      </div>

      <UnavailablePanel
        envelope={feed}
        title="Experiment results are not available"
      />

      <SectionCard
        title="Experiment history"
        description="Each run is identified by a definition hash and a data fingerprint, so two runs with the same hash are comparable."
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
              icon={FlaskConical}
              title="No experiments have been run"
              description="No validation run is stored. Nothing is shown rather than a placeholder performance chart, because a fabricated result would be indistinguishable from a measured one."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Experiment</TableHead>
                  <TableHead className="hidden sm:table-cell">Signal version</TableHead>
                  <TableHead className="hidden xl:table-cell">Period</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right 2xl:table-cell">Flags</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Created</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feed.data.items.map((item) => {
                  const status = experimentStatus(item.status);
                  const active = item.id === selectedId;
                  return (
                    <TableRow key={item.id} className={cn(active && "bg-accent/40")}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="max-w-56 truncate text-[11px] font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {item.definitionHash.slice(0, 12)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-[10px] text-muted-foreground sm:table-cell">
                        {item.signalVersion}
                      </TableCell>
                      <TableCell className="hidden font-mono text-[10px] tabular text-muted-foreground xl:table-cell">
                        {formatDate(item.periodStart)} → {formatDate(item.periodEnd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                        {formatNumber(item.sampleSize, { digits: 0 })}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={status.label} tone={status.tone} />
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground 2xl:table-cell">
                        {item.flags.length}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground xl:table-cell">
                        {formatDateTime(item.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/intelligence/performance?id=${encodeURIComponent(item.id)}`}
                          aria-current={active ? "true" : undefined}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {active ? "Selected" : "Open"}
                          <span className="sr-only"> {item.name}</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {experiment ? (
        <ExperimentResultCard experiment={experiment} />
      ) : feed.data.items.length > 0 ? (
        <CoverageWarning severity="warning" title="This experiment could not be loaded">
          The engine did not return the selected experiment. It may have been removed, or
          the request failed. No result is shown rather than a partial one.
        </CoverageWarning>
      ) : null}

      {signalId ? (
        <SectionCard
          title="Signal validation"
          description={`Measured validation for signal ${signalId.slice(0, 8)}.`}
          action={
            <Link
              href="/intelligence/performance"
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Close
            </Link>
          }
        >
          {validation?.data ? (
            <ValidationPanel validation={validation.data} />
          ) : (
            <CoverageWarning severity="warning" title="No validation stored for this signal">
              The engine returned no validation for this signal identifier. A signal can
              exist without a measured result, and that absence is shown rather than
              filled with a default.
            </CoverageWarning>
          )}
        </SectionCard>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
          <LineChart className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            To inspect a single signal&rsquo;s measured validation, open a signal on the{" "}
            <Link href="/intelligence" className="text-primary hover:underline">
              overview
            </Link>{" "}
            and follow &ldquo;Measured validation&rdquo; from its evidence panel.
          </p>
        </div>
      )}

      {feed.data.caveats.length > 0 ? (
        <SectionCard
          title="Engine caveats"
          description="Reported with this payload, unedited."
        >
          <ul className="flex flex-col gap-1.5">
            {feed.data.caveats.map((item) => (
              <li key={item}>
                <CoverageWarning severity="info" title={item} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <Sigma className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          A positive mean forward return is not a profitable strategy. It ignores
          position sizing, capital constraints, borrow, liquidity and the possibility
          that the sample is too small or too overlapping to distinguish from noise.
        </p>
      </div>
    </div>
  );
}
