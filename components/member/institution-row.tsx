import Link from "next/link";

import type { Institution } from "@/lib/api/contracts";
import { institutionHref } from "@/lib/member/links";
import { Badge, formatDate, formatUsd } from "./ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">{label}</dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums text-mk-fg">{value}</dd>
    </div>
  );
}

export function InstitutionRow({ institution }: { institution: Institution }) {
  const periodCount = institution.periods.length;
  // A filer with no stored quarter has no reported positions. Printing "0
  // positions" would read as "this manager holds nothing", which is a claim the
  // engine never made.
  const hasPeriod = institution.latestPeriod !== null;

  return (
    <li className="relative flex flex-col gap-3 border-b border-mk-line px-4 py-4 transition-colors last:border-b-0 hover:bg-mk-surface/40 focus-within:bg-mk-surface/40">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={institutionHref(institution.cik)}
          className="text-sm font-semibold text-mk-fg underline-offset-4 after:absolute after:inset-0 hover:text-mk-accent hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-accent"
        >
          {institution.name}
        </Link>
        <Badge>CIK {institution.cik}</Badge>
        {institution.caveats.length > 0 ? <Badge tone="warn">Disclosure limits</Badge> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat
          label="Reported value"
          value={
            institution.reportedValueUsd === null ? "not disclosed" : formatUsd(institution.reportedValueUsd)
          }
        />
        <Stat
          label="Positions"
          value={hasPeriod ? institution.positionCount.toLocaleString() : "not collected"}
        />
        <Stat label="Quarter end" value={formatDate(institution.latestPeriod)} />
        <Stat label="Became public" value={formatDate(institution.latestPublicAvailableAt)} />
      </dl>

      <p className="font-marketing-mono text-[11px] text-mk-dim">
        {periodCount === 0
          ? "No quarter stored for this filer"
          : `${periodCount} quarter${periodCount === 1 ? "" : "s"} stored`}
        {hasPeriod ? " · reported holdings, not a current position" : ""}
      </p>

      {institution.caveats.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {institution.caveats.map((caveat) => (
            <li key={caveat} className="text-xs leading-relaxed text-mk-muted text-pretty">
              {caveat}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
