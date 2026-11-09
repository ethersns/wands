import type { Metadata } from "next";
import Link from "next/link";

import { InstitutionHoldings } from "@/components/member/institution-holdings";
import {
  EmptyState,
  PageHeader,
  Panel,
  ProvenanceNote,
  StatTile,
  formatDate,
  formatUsd,
  toNumber,
} from "@/components/member/ui";
import type { InstitutionalHoldingChange } from "@/lib/api/contracts";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Institution" };

type PageProps = {
  params: Promise<{ cik: string }>;
  searchParams: Promise<{ period?: string }>;
};

/** A CIK is up to ten digits. Anything else cannot address a stored filer. */
const CIK_PATTERN = /^\d{1,10}$/;
/** The engine accepts an ISO instant for `period`; anything else is ignored. */
const PERIOD_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;

/**
 * Figures derived from the reported change set.
 *
 * The engine has no single-institution summary endpoint, so the totals here are
 * arithmetic over the rows it did return rather than a second source of truth.
 * A position is "held" when the current filing reports it, which is exactly the
 * set of rows that are not exits.
 */
function summarise(changes: InstitutionalHoldingChange[]) {
  const held = changes.filter((change) => change.changeType !== "exited");
  const priorHeld = changes.filter((change) => change.changeType !== "new");

  const disclosed = held
    .map((change) => toNumber(change.currentValueUsd))
    .filter((value): value is number => value !== null);

  const publicAt = changes.reduce<string | null>((latest, change) => {
    if (!change.publicAvailableAt) return latest;
    if (!latest) return change.publicAvailableAt;
    return new Date(change.publicAvailableAt) > new Date(latest) ? change.publicAvailableAt : latest;
  }, null);

  return {
    held: held.length,
    priorHeld: priorHeld.length,
    total: disclosed.length > 0 ? disclosed.reduce((sum, value) => sum + value, 0) : null,
    undisclosed: held.length - disclosed.length,
    publicAt,
  };
}

export default async function InstitutionDetailPage({ params, searchParams }: PageProps) {
  const { cik: rawCik } = await params;
  const { period: rawPeriod } = await searchParams;

  const cik = rawCik.trim();
  await requireMember(`/app/institutions/${cik}`);

  if (!CIK_PATTERN.test(cik)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Form 13F holdings"
          title="That is not a CIK"
          description="A filer is addressed by its SEC Central Index Key, which is up to ten digits. Nothing was looked up."
        />
        <EmptyState
          title="No filer addressed"
          description="The identifier in this link is not a CIK, so no institution was read and no holdings are shown."
          action={
            <Link
              href="/app/institutions"
              className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
            >
              Back to institutions
            </Link>
          }
        />
      </div>
    );
  }

  const period = rawPeriod && PERIOD_PATTERN.test(rawPeriod) ? rawPeriod : undefined;
  const envelope = await memberResearch.institutionChanges(cik, period);
  const result = envelope.data;
  const name = result.name || `CIK ${cik}`;

  const backLink = (
    <Link
      href="/app/institutions"
      className="font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
    >
      All institutions
    </Link>
  );

  if (envelope.unreachable) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Form 13F holdings"
          title={name}
          description="The research engine could not be reached, so nothing is shown. This is not an empty filing."
          actions={backLink}
        />
        <EmptyState
          title="Institution research unavailable"
          description="The engine did not answer this request. No holdings, values or change figures are displayed, because none were read."
        />
        <ProvenanceNote
          provenance={envelope.provenance}
          generatedAt={envelope.generatedAt}
          warnings={envelope.warnings}
          unreachable={envelope.unreachable}
        />
      </div>
    );
  }

  if (result.changes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Form 13F holdings"
          title={name}
          description="No quarter-over-quarter change is available for this filer."
          actions={backLink}
        />
        <EmptyState
          title="No change can be calculated"
          description="A change needs two stored quarters. Either no 13F holdings are stored for this filer, or only one quarter has been collected so far. Neither case means the manager holds nothing."
        />
        <ProvenanceNote
          provenance={envelope.provenance}
          generatedAt={envelope.generatedAt}
          warnings={envelope.warnings}
          unreachable={envelope.unreachable}
        />
      </div>
    );
  }

  const stats = summarise(result.changes);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Form 13F holdings"
        title={name}
        description={`Reported positions for the quarter ended ${formatDate(result.periodOfReport)}, compared with the quarter ended ${formatDate(result.priorPeriodOfReport)}.`}
        actions={backLink}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Reported value"
          value={stats.total === null ? "not disclosed" : formatUsd(stats.total)}
          hint={
            stats.undisclosed > 0
              ? `sum of ${stats.held - stats.undisclosed} disclosed lines; ${stats.undisclosed} undisclosed`
              : "sum of reported values at quarter end"
          }
        />
        <StatTile
          label="Positions reported"
          value={stats.held.toLocaleString()}
          hint={`${stats.priorHeld.toLocaleString()} in the prior quarter`}
        />
        <StatTile
          label="Quarter end"
          value={formatDate(result.periodOfReport)}
          hint="the date the snapshot describes"
          valueClassName="text-lg sm:text-xl"
        />
        <StatTile
          label="Became public"
          value={formatDate(stats.publicAt)}
          hint="when the filing was accepted by the SEC"
          valueClassName="text-lg sm:text-xl"
        />
      </div>

      <Panel title="Reported changes" bodyClassName="p-0">
        <InstitutionHoldings
          changes={result.changes}
          periodOfReport={result.periodOfReport}
          priorPeriodOfReport={result.priorPeriodOfReport}
        />
      </Panel>

      <Panel title="What this does and does not show">
        <ul className="flex flex-col gap-2">
          <li className="text-sm leading-relaxed text-mk-muted text-pretty">
            These are the positions the manager reported holding at the quarter end. They are not current or
            real-time positions, and the manager may have traded in either direction since.
          </li>
          <li className="text-sm leading-relaxed text-mk-muted text-pretty">
            A change between two quarterly snapshots is not evidence of a trade on any particular date. A position
            that disappears from a filing is a reported absence, not an observed sale.
          </li>
          <li className="text-sm leading-relaxed text-mk-muted text-pretty">
            Form 13F excludes short positions, cash and most non-13(f) securities, so the reported value is not the
            manager&apos;s total assets under management.
          </li>
          {result.caveats.map((caveat) => (
            <li key={caveat} className="text-sm leading-relaxed text-mk-muted text-pretty">
              {caveat}
            </li>
          ))}
        </ul>
      </Panel>

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={envelope.warnings}
        unreachable={envelope.unreachable}
      />
    </div>
  );
}
