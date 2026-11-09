import Link from "next/link";

import { Badge } from "@/components/member/ui";
import type {
  Catalyst,
  CatalystCategory,
  CatalystStatus,
  CatalystTimePrecision,
} from "@/lib/api/research-contract";
import { assetHref } from "@/lib/member/links";

const CATEGORY_LABEL: Record<CatalystCategory, string> = {
  monetary_policy: "Monetary policy",
  earnings: "Earnings",
  economic_release: "Economic release",
  insider_disclosure: "Insider disclosure",
  institutional_disclosure: "Institutional disclosure",
};

const STATUS_TONE: Record<CatalystStatus, "neutral" | "accent" | "warn" | "emerald"> = {
  scheduled: "accent",
  confirmed: "emerald",
  tentative: "warn",
  cancelled: "warn",
  postponed: "warn",
  published: "neutral",
};

const PRECISION_LABEL: Record<CatalystTimePrecision, string> = {
  exact: "exact time",
  approximate: "approx. time",
  date_only: "date only",
  unconfirmed: "unconfirmed",
};

/**
 * The day a catalyst sits on, and how precisely that day is known.
 *
 * A date-only event renders a date and the words "date only". It never renders a
 * clock time, because the source published none and a time on screen is
 * indistinguishable from a time the source gave.
 */
function when(catalyst: Catalyst): { day: string; note: string } {
  if (catalyst.scheduledDate) {
    return { day: catalyst.scheduledDate, note: PRECISION_LABEL[catalyst.timePrecision] };
  }

  const instant = catalyst.scheduledAt ?? catalyst.publishedAt;
  if (!instant) {
    return { day: "—", note: "no date" };
  }

  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return { day: "—", note: "unreadable date" };
  }

  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: catalyst.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(parsed)
      .replace(",", "");
  } catch {
    formatted = parsed.toISOString().slice(0, 16).replace("T", " ");
  }

  return {
    day: formatted,
    // A disclosure is anchored to when it became public, which is a different
    // claim from the "published" status badge beside the title.
    note: catalyst.scheduledAt ? PRECISION_LABEL[catalyst.timePrecision] : "publication time",
  };
}

function CatalystRow({ catalyst }: { catalyst: Catalyst }) {
  const { day, note } = when(catalyst);

  return (
    <li className="flex gap-4">
      <div className="flex w-24 shrink-0 flex-col items-end pt-0.5 sm:w-28">
        <span className="font-marketing-mono text-[11px] tabular-nums text-mk-fg">{day}</span>
        <span className="mt-0.5 text-right text-[10px] uppercase tracking-[0.1em] text-mk-dim">
          {note}
        </span>
      </div>

      <div className="relative flex-1 border-l border-mk-line pb-5 pl-4 last:pb-0">
        <span
          aria-hidden="true"
          className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-mk-accent"
        />

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-mk-fg text-pretty">{catalyst.title}</p>
          <Badge tone={STATUS_TONE[catalyst.status]}>{catalyst.status}</Badge>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
            {CATEGORY_LABEL[catalyst.category]}
          </span>

          {catalyst.symbols.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {catalyst.symbols.map((symbol) => (
                <Link
                  key={symbol}
                  href={assetHref(symbol)}
                  className="font-marketing-mono text-[10px] uppercase tracking-[0.1em] text-mk-accent underline-offset-4 hover:underline"
                >
                  {symbol}
                </Link>
              ))}
            </span>
          ) : catalyst.marketWide ? (
            <span className="font-marketing-mono text-[10px] uppercase tracking-[0.1em] text-mk-dim">
              Market-wide
            </span>
          ) : null}

          <span className="font-marketing-mono text-[10px] uppercase tracking-[0.1em] text-mk-dim">
            {catalyst.timeZone}
          </span>
        </div>

        {catalyst.warnings.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {catalyst.warnings.map((warning) => (
              <li key={warning} className="text-xs leading-relaxed text-mk-warn text-pretty">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {catalyst.sourceUrl ? (
            <a
              href={catalyst.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
            >
              {catalyst.sourceName}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-xs text-mk-muted">{catalyst.sourceName}</span>
          )}

          {catalyst.occurredAt ? (
            <span className="text-[11px] text-mk-dim">
              happened {catalyst.occurredAt.slice(0, 10)}
            </span>
          ) : null}

          <span className="text-[11px] text-mk-dim">
            collected {catalyst.collectedAt.slice(0, 10)}
          </span>
        </div>
      </div>
    </li>
  );
}

export function CatalystTimeline({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: Catalyst[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-mk-line px-4 py-6">
        <p className="text-sm font-medium text-mk-fg">{emptyTitle}</p>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-mk-muted text-pretty">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col">
      {items.map((catalyst) => (
        <CatalystRow key={catalyst.id} catalyst={catalyst} />
      ))}
    </ol>
  );
}
