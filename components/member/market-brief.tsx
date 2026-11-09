import Link from "next/link";

import {
  Badge,
  EmptyState,
  Panel,
  StatTile,
  formatDate,
  formatShares,
  formatUsd,
} from "@/components/member/ui";
import type { InsiderTransaction, Institution, ResearchSignal } from "@/lib/api/contracts";
import type { Catalyst, CatalystTimePrecision } from "@/lib/api/research-contract";
import {
  BRIEF_RULES,
  type BriefInvestigation,
  type BriefLimitation,
  type BriefReason,
  type MarketBrief,
} from "@/lib/member/brief";
import { assetHref, filingHref, institutionHref, signalHref } from "@/lib/member/links";

const PRECISION_LABEL: Record<CatalystTimePrecision, string> = {
  exact: "exact time",
  approximate: "approximate time",
  date_only: "date only",
  unconfirmed: "unconfirmed",
};

const REASON_TONE: Record<BriefReason, "neutral" | "accent" | "warn" | "emerald"> = {
  watched_disclosure: "accent",
  watched_catalyst: "emerald",
  market_catalyst: "neutral",
  watched_signal: "accent",
  source_stale: "warn",
};

const FRESHNESS_TONE: Record<string, "neutral" | "accent" | "warn" | "emerald"> = {
  fresh: "emerald",
  stale: "warn",
  never: "warn",
  failing: "warn",
};

const CATALYST_LIMIT = 6;
const INSIDER_LIMIT = 6;
const INSTITUTION_LIMIT = 5;
const SIGNAL_LIMIT = 6;

function formatStamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * When a catalyst falls, and how precisely the source said so.
 *
 * A `date_only` event carries a calendar day and no clock time. Rendering a time
 * for it would invent information the source never published.
 */
function catalystWhen(catalyst: Catalyst): { day: string; note: string } {
  if (catalyst.scheduledDate) {
    return { day: catalyst.scheduledDate, note: PRECISION_LABEL[catalyst.timePrecision] };
  }
  if (catalyst.scheduledAt) {
    return {
      day: catalyst.scheduledAt.slice(0, 10),
      note: `${catalyst.scheduledAt.slice(11, 16)} UTC · ${PRECISION_LABEL[catalyst.timePrecision]}`,
    };
  }
  return { day: formatDate(catalyst.publishedAt), note: "publication time" };
}

function SourceLink({ name, url }: { name: string | null; url: string | null }) {
  if (!name) return null;
  if (!url) {
    return <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">{name}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim underline-offset-4 hover:text-mk-accent hover:underline"
    >
      {name}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* A. Market context                                                   */
/* ------------------------------------------------------------------ */

function MarketContextSection({ brief }: { brief: MarketBrief }) {
  const { context } = brief;

  return (
    <Panel
      title="Market context"
      action={<Badge tone={FRESHNESS_TONE[context.freshness] ?? "neutral"}>{context.freshness}</Badge>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Filings stored" value={context.counts.filings} hint="SEC filings collected" />
        <StatTile label="Transactions" value={context.counts.transactions} hint="insider lines parsed" />
        <StatTile label="Signals" value={context.counts.signals} hint="engine-produced" />
        <StatTile label="Symbols" value={context.counts.symbols} hint="with research coverage" />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-mk-line pt-4 sm:grid-cols-3">
        <div>
          <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
            Latest filing
          </dt>
          <dd className="mt-1 font-marketing-mono text-xs text-mk-fg">{formatStamp(context.latestFilingAt)}</dd>
        </div>
        <div>
          <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
            Latest signal
          </dt>
          <dd className="mt-1 font-marketing-mono text-xs text-mk-fg">{formatStamp(context.latestSignalAt)}</dd>
        </div>
        <div>
          <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
            Published coverage
          </dt>
          <dd className="mt-1 font-marketing-mono text-xs text-mk-fg">{context.coverageStatus}</dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
        {context.priceDataNote}
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* B. Upcoming catalysts                                               */
/* ------------------------------------------------------------------ */

function CatalystSection({ brief }: { brief: MarketBrief }) {
  const upcoming = brief.upcomingCatalysts.slice(0, CATALYST_LIMIT);
  const unread = brief.catalystSources.filter((source) => source.status !== "ok");

  return (
    <Panel
      title="Upcoming catalysts"
      action={
        <Link
          href="/app/catalysts"
          className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
        >
          Catalyst Radar
        </Link>
      }
    >
      {upcoming.length === 0 ? (
        <EmptyState
          title="No scheduled event in the window"
          description="Catalyst Radar returned no upcoming event for this window. That is an empty calendar, not a claim that nothing is scheduled."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-mk-line">
          {upcoming.map((catalyst) => {
            const when = catalystWhen(catalyst);
            return (
              <li key={catalyst.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-marketing-mono text-xs tabular-nums text-mk-fg">{when.day}</span>
                  <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    {when.note}
                  </span>
                  {catalyst.marketWide ? <Badge tone="neutral">market-wide</Badge> : null}
                  {catalyst.symbols.length > 0 ? (
                    <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-accent">
                      {catalyst.symbols.join(" · ")}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-mk-fg text-pretty">{catalyst.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceLink name={catalyst.sourceName} url={catalyst.sourceUrl} />
                  <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    {catalyst.status}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unread.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-mk-line pt-3">
          {unread.map((source) => (
            <li key={source.source} className="text-xs leading-relaxed text-mk-warn text-pretty">
              {source.label} — {source.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* C. Important disclosures                                            */
/* ------------------------------------------------------------------ */

function InsiderRow({ transaction }: { transaction: InsiderTransaction }) {
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={assetHref(transaction.symbol)}
          className="font-marketing-mono text-xs text-mk-accent underline-offset-4 hover:underline"
        >
          {transaction.symbol}
        </Link>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {transaction.classification.replaceAll("_", " ")}
        </span>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          filed {formatStamp(transaction.acceptedAt)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-mk-fg text-pretty">
        {transaction.reportingPersonName} · {transaction.role}
      </p>
      <p className="font-marketing-mono text-[11px] text-mk-muted">
        {formatShares(transaction.shares)} shares · {formatUsd(transaction.value)} ·{" "}
        {transaction.transactionDate ? `traded ${transaction.transactionDate}` : "trade date not reported"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={filingHref(transaction.id)}
          className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim underline-offset-4 hover:text-mk-accent hover:underline"
        >
          Open filing
        </Link>
        <SourceLink name="SEC EDGAR" url={transaction.sourceUrl} />
      </div>
    </li>
  );
}

function InstitutionRow({ institution }: { institution: Institution }) {
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={institutionHref(institution.cik)}
          className="text-sm text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
        >
          {institution.name}
        </Link>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          CIK {institution.cik}
        </span>
      </div>
      <p className="font-marketing-mono text-[11px] text-mk-muted">
        {institution.latestPeriod ? `quarter ending ${institution.latestPeriod}` : "period not reported"} ·{" "}
        {institution.positionCount} positions · {formatUsd(institution.reportedValueUsd)}
      </p>
      <p className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
        published {formatStamp(institution.latestPublicAvailableAt)}
      </p>
    </li>
  );
}

function DisclosureSection({ brief }: { brief: MarketBrief }) {
  const insiders = brief.insiderDisclosures.slice(0, INSIDER_LIMIT);
  const institutions = brief.institutionalFilings.slice(0, INSTITUTION_LIMIT);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title="Insider disclosures"
        action={
          <Link
            href="/app/insiders"
            className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Insider Radar
          </Link>
        }
      >
        {insiders.length === 0 ? (
          <EmptyState
            title="No insider filing stored"
            description="Nothing has been collected for this window. An empty list here means no filing is stored, not that no insider filed."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-mk-line">
            {insiders.map((transaction) => (
              <InsiderRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
          A transaction date is when the trade happened. The filing date is when it became public, and only
          that date is used to decide whether a disclosure is new.
        </p>
      </Panel>

      <Panel
        title="Institutional filings"
        action={
          <Link
            href="/app/institutions"
            className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Institutional Radar
          </Link>
        }
      >
        {institutions.length === 0 ? (
          <EmptyState
            title="No 13F filing stored"
            description="No institutional filing has been collected. Quarterly holdings are reported after the quarter closes, so an empty list is a collection state."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-mk-line">
            {institutions.map((institution) => (
              <InstitutionRow key={institution.cik} institution={institution} />
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
          A 13F reports a position as of a quarter end and becomes public up to 45 days later. It is a
          historical snapshot, never live buying or selling.
        </p>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* D. Research signals                                                 */
/* ------------------------------------------------------------------ */

function SignalRow({ signal }: { signal: ResearchSignal }) {
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={assetHref(signal.symbol)}
          className="font-marketing-mono text-xs text-mk-accent underline-offset-4 hover:underline"
        >
          {signal.symbol}
        </Link>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {signal.category.replaceAll("_", " ").toLowerCase()}
        </span>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          public {formatStamp(signal.publicAvailableAt)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-mk-fg text-pretty">{signal.explanation}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {signal.score === null
            ? "no research ranking"
            : `research ranking ${signal.score.toFixed(0)}/100 · not a probability`}
        </span>
        <Badge tone={signal.dataQuality === "reported" ? "emerald" : "neutral"}>{signal.dataQuality}</Badge>
        <Link
          href={signalHref(signal.id)}
          className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim underline-offset-4 hover:text-mk-accent hover:underline"
        >
          Open signal
        </Link>
      </div>
    </li>
  );
}

function SignalSection({ brief }: { brief: MarketBrief }) {
  const signals = brief.signals.slice(0, SIGNAL_LIMIT);

  return (
    <Panel
      title="Research signals"
      action={
        <Link
          href="/app/signals"
          className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
        >
          All signals
        </Link>
      }
    >
      {signals.length === 0 ? (
        <EmptyState
          title="No signal stored"
          description="The signal engine has produced nothing for this window. This brief does not compute its own signals, so there is nothing to show."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-mk-line">
          {signals.map((signal) => (
            <SignalRow key={signal.id} signal={signal} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* E. What deserves investigation                                      */
/* ------------------------------------------------------------------ */

function InvestigationRow({ item }: { item: BriefInvestigation }) {
  return (
    <li className="flex flex-col gap-1.5 py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={REASON_TONE[item.reason]}>
          {BRIEF_RULES.find((rule) => rule.reason === item.reason)?.label ?? item.reason}
        </Badge>
        {item.symbol ? (
          <Link
            href={assetHref(item.symbol)}
            className="font-marketing-mono text-xs text-mk-accent underline-offset-4 hover:underline"
          >
            {item.symbol}
          </Link>
        ) : null}
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {formatStamp(item.observedAt)}
        </span>
      </div>
      <Link
        href={item.href}
        className="text-sm font-medium leading-relaxed text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline text-pretty"
      >
        {item.title}
      </Link>
      <p className="text-xs leading-relaxed text-mk-muted text-pretty">{item.detail}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SourceLink name={item.sourceName} url={item.sourceUrl} />
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {item.dataQuality}
        </span>
      </div>
    </li>
  );
}

function InvestigationSection({ brief }: { brief: MarketBrief }) {
  return (
    <section className="overflow-hidden rounded-xl border border-mk-accent/25 bg-mk-accent-soft/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-mk-accent/20 px-4 py-3">
        <h2 className="font-marketing-mono text-[11px] uppercase tracking-[0.16em] text-mk-accent">
          What deserves investigation
        </h2>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {brief.investigations.length} item{brief.investigations.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="p-4">
        {brief.investigations.length === 0 ? (
          <EmptyState
            title="Nothing crossed a rule"
            description={
              brief.watchlist.length === 0
                ? "No symbol is on a watchlist, so no watchlist rule can fire. Add a ticker and the brief will surface disclosures, events and signals for it."
                : "No watched symbol had a new disclosure, an approaching event or a recent signal, and every source is healthy. That is a quiet brief, not a missing one."
            }
            action={
              brief.watchlist.length === 0 ? (
                <Link
                  href="/app/watchlists"
                  className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
                >
                  Add a ticker
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-mk-accent/15">
            {brief.investigations.map((item) => (
              <InvestigationRow key={item.id} item={item} />
            ))}
          </ul>
        )}

        <details className="mt-4 border-t border-mk-accent/20 pt-3">
          <summary className="cursor-pointer font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim hover:text-mk-fg">
            How these items were selected
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {BRIEF_RULES.map((rule) => (
              <li key={rule.reason} className="text-xs leading-relaxed text-mk-muted text-pretty">
                <span className="text-mk-fg">{rule.label}</span> — {rule.rule}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-mk-dim text-pretty">
            These are reasons to open a record, not recommendations to trade. Ordering is by rule, then by
            publication time, then by symbol. No confidence percentage is computed here.
          </p>
        </details>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* F. Known limitations                                                */
/* ------------------------------------------------------------------ */

function LimitationRow({ limitation }: { limitation: BriefLimitation }) {
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-mk-fg">{limitation.label}</span>
        <Badge tone={limitation.severity === "gap" ? "warn" : "neutral"}>{limitation.severity}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-mk-muted text-pretty">{limitation.detail}</p>
    </li>
  );
}

function LimitationSection({ brief }: { brief: MarketBrief }) {
  const gaps = brief.limitations.filter((limitation) => limitation.severity === "gap");
  const caveats = brief.limitations.filter((limitation) => limitation.severity === "caveat");

  return (
    <Panel title="Known limitations">
      {brief.limitations.length === 0 ? (
        <p className="text-sm leading-relaxed text-mk-muted text-pretty">
          No coverage gap or caveat was reported by the engine for this window.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {gaps.length > 0 ? (
            <div>
              <h3 className="mb-1 font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-warn">
                Coverage gaps
              </h3>
              <ul className="flex flex-col divide-y divide-mk-line">
                {gaps.map((limitation) => (
                  <LimitationRow key={limitation.key} limitation={limitation} />
                ))}
              </ul>
            </div>
          ) : null}

          {caveats.length > 0 ? (
            <div>
              <h3 className="mb-1 font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
                Reading caveats
              </h3>
              <ul className="flex flex-col divide-y divide-mk-line">
                {caveats.map((limitation) => (
                  <LimitationRow key={limitation.key} limitation={limitation} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

export function MarketBriefView({ brief }: { brief: MarketBrief }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2.5">
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
          Brief as of
        </span>
        <span className="font-marketing-mono text-xs tabular-nums text-mk-fg">{formatStamp(brief.asOf)}</span>
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          {brief.watchlist.length} watched symbol{brief.watchlist.length === 1 ? "" : "s"}
        </span>
        {brief.unreachable ? <Badge tone="warn">engine unreachable</Badge> : null}
      </div>

      <MarketContextSection brief={brief} />
      <CatalystSection brief={brief} />
      <DisclosureSection brief={brief} />
      <SignalSection brief={brief} />
      <InvestigationSection brief={brief} />
      <LimitationSection brief={brief} />
    </div>
  );
}
