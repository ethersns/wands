import type { Metadata } from "next";
import Link from "next/link";

import { InsiderRow } from "@/components/member/insider-row";
import { SignalRow } from "@/components/member/signal-row";
import { SymbolSearch } from "@/components/member/symbol-search";
import { EmptyState, PageHeader, Panel, ProvenanceNote, StatTile } from "@/components/member/ui";
import { getMembership } from "@/lib/member/membership";
import { unreadCount } from "@/lib/member/notifications";
import { getProfile } from "@/lib/member/profile";
import { memberResearch } from "@/lib/member/research";
import { countSaved } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";
import { listTrackedSymbols, listWatchlists } from "@/lib/member/watchlists";

export const metadata: Metadata = { title: "Overview" };

// The overview fans out to the engine's slowest aggregates. The function budget
// must exceed the engine timeout so a slow engine degrades to the unreachable
// state instead of the whole page failing.
export const maxDuration = 30;

export default async function OverviewPage() {
  const session = await requireMember();
  const userId = session.user.id;

  const [profile, membership, watchlists, tracked, savedCount, unread, dashboard] =
    await Promise.all([
      getProfile(userId),
      getMembership(userId),
      listWatchlists(userId),
      listTrackedSymbols(userId),
      countSaved(userId),
      unreadCount(userId),
      memberResearch.dashboard(),
    ]);

  const firstName = (profile?.displayName ?? session.user.name).split(" ")[0];

  // The dashboard aggregate is the contract's source for counts, top signals and
  // recent purchases. There is no feed fallback: the feeds are the operator
  // console's surface, and substituting one would report a page of the feed
  // under the dashboard's label.
  const { counts, topSignals, recentPurchases, caveats } = dashboard.data;
  // An outage and an empty collection are different states. Only an unreachable
  // engine is reported as one; a reachable engine with zero rows is a gap.
  const engineReachable = !dashboard.unreachable;
  const engineReason = dashboard.warnings[0] ?? "The dashboard could not be read from the engine.";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title={`Welcome back, ${firstName}`}
        description="Your tracked names, the latest insider filings and the signals the engine has published."
      />

      <div className="max-w-xl">
        <SymbolSearch />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Tracked symbols"
          value={tracked.length}
          hint={`${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"}`}
        />
        <StatTile label="Saved research" value={savedCount} hint={`${membership.label} plan`} />
        <StatTile label="Unread alerts" value={unread} hint="In-app notifications" />
        <StatTile
          label="Filings indexed"
          value={counts.filings.toLocaleString()}
          hint={`${counts.transactions.toLocaleString()} transactions`}
        />
      </div>

      <Panel
        title="Tracked symbols"
        action={
          <Link
            href="/app/watchlists"
            className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
          >
            Manage
          </Link>
        }
      >
        {tracked.length === 0 ? (
          <EmptyState
            title="No symbols tracked yet"
            description="Add a ticker to a watchlist and it will appear here with its insider activity and signals."
            action={
              <Link
                href="/app/watchlists"
                className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
              >
                Add a ticker
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tracked.map((entry) => (
              <li key={`${entry.marketType}:${entry.symbol}`}>
                <Link
                  href={`/app/assets/${encodeURIComponent(entry.symbol)}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-mk-line bg-mk-raised px-2.5 py-1.5 font-marketing-mono text-xs text-mk-fg transition-colors hover:border-mk-accent/40 hover:text-mk-accent"
                >
                  {entry.symbol}
                  {entry.marketType === "crypto" ? (
                    <span className="rounded border border-mk-line px-1 text-[9px] uppercase tracking-[0.1em] text-mk-dim">
                      Crypto
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Recent insider activity"
          bodyClassName="p-0"
          action={
            <Link
              href="/app/insiders"
              className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
            >
              All filings
            </Link>
          }
        >
          {recentPurchases.length === 0 ? (
            <div className="p-4">
              {engineReachable ? (
                <EmptyState
                  title="No recent purchases found"
                  description="No open-market insider purchase is stored. This is a collection state, not a statement that no insider bought."
                />
              ) : (
                <EmptyState title="Research engine unreachable" description={engineReason} />
              )}
            </div>
          ) : (
            <ul>
              {recentPurchases.map((transaction) => (
                <InsiderRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest signals"
          bodyClassName="p-0"
          action={
            <Link
              href="/app/signals"
              className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
            >
              All signals
            </Link>
          }
        >
          {topSignals.length === 0 ? (
            <div className="p-4">
              {engineReachable ? (
                <EmptyState
                  title="Research signal unavailable"
                  description="No signal has been generated. Signals are only produced when a configured threshold is met, so this is expected for most symbols."
                />
              ) : (
                <EmptyState title="Research engine unreachable" description={engineReason} />
              )}
            </div>
          ) : (
            <ul>
              {topSignals.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ProvenanceNote
        provenance={dashboard.provenance}
        generatedAt={dashboard.generatedAt}
        warnings={[...dashboard.warnings, ...caveats].slice(0, 3)}
        unreachable={dashboard.unreachable}
      />
    </div>
  );
}
