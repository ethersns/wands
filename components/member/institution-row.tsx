import type { Institution } from "@/lib/api/contracts";
import { Badge, formatDate, formatUsd } from "./ui";

export function InstitutionRow({ institution }: { institution: Institution }) {
  const periodCount = institution.periods.length;

  return (
    <li className="flex flex-col gap-2 border-b border-mk-line px-4 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-mk-fg">{institution.name}</span>
        <Badge>CIK {institution.cik}</Badge>
        {institution.caveats.length > 0 ? <Badge tone="warn">Caveats</Badge> : null}
      </div>

      <p className="font-marketing-mono text-[11px] text-mk-dim">
        {institution.reportedValueUsd === null
          ? "reported value not disclosed"
          : `${formatUsd(institution.reportedValueUsd)} reported`}
        {" · "}
        {institution.positionCount.toLocaleString()} positions
        {" · "}
        {periodCount === 0 ? "no period stored" : `${periodCount} period${periodCount === 1 ? "" : "s"}`}
        {" · latest "}
        {institution.latestPeriod ?? "—"}
        {" · public "}
        {formatDate(institution.latestPublicAvailableAt)}
      </p>

      {institution.caveats.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {institution.caveats.map((caveat) => (
            <li key={caveat} className="text-xs text-mk-muted">
              {caveat}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
