"use client";

import { useMemo, useState } from "react";

import type { InstitutionalChangeType, InstitutionalHoldingChange } from "@/lib/api/contracts";
import { Badge, formatDate, formatShares, formatUsd, toNumber } from "./ui";

const CHANGE_LABEL: Record<InstitutionalChangeType, string> = {
  new: "New",
  increased: "Increased",
  decreased: "Decreased",
  exited: "Exited",
  unchanged: "Unchanged",
};

const CHANGE_TONE: Record<InstitutionalChangeType, "neutral" | "accent" | "warn" | "emerald"> = {
  new: "accent",
  increased: "emerald",
  decreased: "neutral",
  // An absent CUSIP is a reported absence, not an observed sale, so it is
  // flagged rather than styled as a directional move.
  exited: "warn",
  unchanged: "neutral",
};

const CHANGE_ORDER: InstitutionalChangeType[] = ["new", "increased", "decreased", "exited", "unchanged"];

type SortKey = "value" | "change" | "issuer";

const SORT_LABEL: Record<SortKey, string> = {
  value: "Reported value, largest first",
  change: "Reported value change, largest first",
  issuer: "Issuer name, A–Z",
};

function reportedValue(change: InstitutionalHoldingChange): number {
  return toNumber(change.currentValueUsd) ?? toNumber(change.priorValueUsd) ?? -1;
}

function reportedValueChange(change: InstitutionalHoldingChange): number {
  return (toNumber(change.currentValueUsd) ?? 0) - (toNumber(change.priorValueUsd) ?? 0);
}

/** Only an http(s) URL is rendered as a source link. */
function safeSourceUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function describeChange(change: InstitutionalHoldingChange): string {
  if (change.changeType === "new") {
    return `New position of ${formatShares(change.currentShares)} shares`;
  }
  if (change.changeType === "exited") {
    return `No position reported; ${formatShares(change.priorShares)} shares in the prior quarter`;
  }

  const delta = toNumber(change.shareChange);
  if (delta === null) return "Share change not reported";
  if (delta === 0) return "Unchanged";

  const pct = toNumber(change.shareChangePct);
  const suffix = pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  return `${delta > 0 ? "Added" : "Reduced"} ${formatShares(Math.abs(delta))} shares${suffix}`;
}

function HoldingRow({ change }: { change: InstitutionalHoldingChange }) {
  const source = safeSourceUrl(change.sourceUrl);
  const currentValue = toNumber(change.currentValueUsd);
  const priorValue = toNumber(change.priorValueUsd);
  const held = change.changeType !== "exited";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-b border-mk-line px-4 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-mk-fg">
            {change.issuerName || "Issuer not reported"}
          </span>
          <Badge tone={CHANGE_TONE[change.changeType]}>{CHANGE_LABEL[change.changeType]}</Badge>
        </div>
        <p className="mt-0.5 font-marketing-mono text-[11px] text-mk-dim">
          CUSIP {change.cusip || "not reported"}
          {change.classTitle ? ` · ${change.classTitle}` : ""}
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm tabular-nums text-mk-fg">
          {held ? formatUsd(currentValue) : <span className="text-mk-dim">no position</span>}
        </p>
        {held ? (
          <p className="font-marketing-mono text-[11px] tabular-nums text-mk-dim">
            {formatShares(change.currentShares)} sh
          </p>
        ) : null}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-marketing-mono text-[11px] text-mk-muted">
        <span>{describeChange(change)}</span>
        {priorValue !== null ? <span>prior {formatUsd(priorValue)}</span> : null}
        <span>public {formatDate(change.publicAvailableAt)}</span>
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noreferrer noopener"
            className="text-mk-accent underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-accent"
          >
            SEC filing
          </a>
        ) : (
          <span className="text-mk-dim">no source link resolved</span>
        )}
      </div>
    </li>
  );
}

export function InstitutionHoldings({
  changes,
  periodOfReport,
  priorPeriodOfReport,
}: {
  changes: InstitutionalHoldingChange[];
  periodOfReport: string | null;
  priorPeriodOfReport: string | null;
}) {
  const [filter, setFilter] = useState<InstitutionalChangeType | "all">("all");
  const [sort, setSort] = useState<SortKey>("value");

  const counts = useMemo(() => {
    const tally = new Map<InstitutionalChangeType, number>();
    for (const change of changes) {
      tally.set(change.changeType, (tally.get(change.changeType) ?? 0) + 1);
    }
    return tally;
  }, [changes]);

  const visible = useMemo(() => {
    const rows = filter === "all" ? changes : changes.filter((change) => change.changeType === filter);
    const sorted = [...rows];
    if (sort === "issuer") {
      sorted.sort((a, b) => (a.issuerName || "").localeCompare(b.issuerName || ""));
    } else if (sort === "change") {
      sorted.sort((a, b) => reportedValueChange(b) - reportedValueChange(a));
    } else {
      sorted.sort((a, b) => reportedValue(b) - reportedValue(a));
    }
    return sorted;
  }, [changes, filter, sort]);

  const presentTypes = CHANGE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-mk-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by change type">
          <button
            type="button"
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
            className={`rounded-full border px-2.5 py-1 font-marketing-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-accent ${
              filter === "all"
                ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
                : "border-mk-line text-mk-muted hover:text-mk-fg"
            }`}
          >
            {`All ${changes.length}`}
          </button>
          {presentTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              aria-pressed={filter === type}
              className={`rounded-full border px-2.5 py-1 font-marketing-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-accent ${
                filter === type
                  ? "border-mk-accent/40 bg-mk-accent-soft text-mk-accent"
                  : "border-mk-line text-mk-muted hover:text-mk-fg"
              }`}
            >
              {`${CHANGE_LABEL[type]} ${counts.get(type)}`}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-marketing-mono text-[11px] text-mk-dim">
            {filter === "all"
              ? `${changes.length} reported change${changes.length === 1 ? "" : "s"}`
              : `${visible.length} of ${changes.length} reported changes`}
            {periodOfReport ? ` · quarter ended ${formatDate(periodOfReport)}` : ""}
            {priorPeriodOfReport ? ` · compared with ${formatDate(priorPeriodOfReport)}` : ""}
          </p>

          <div className="flex items-center gap-2">
            <label
              htmlFor="holdings-sort"
              className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim"
            >
              Sort
            </label>
            <select
              id="holdings-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded-lg border border-mk-line bg-mk-surface px-2 py-1.5 text-xs text-mk-fg focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-sm leading-relaxed text-mk-muted text-pretty">
          No reported change of this type in the quarter. The other change types are still listed above.
        </p>
      ) : (
        <ul>
          {visible.map((change) => (
            <HoldingRow key={`${change.cusip}-${change.changeType}`} change={change} />
          ))}
        </ul>
      )}
    </div>
  );
}
