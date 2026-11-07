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

export default async function OverviewPage() {
  const session = await requireMember();
  const userId = session.user.id;

  const [profile, membership, watchlists, tracked, savedCount, unread, dashboard, insiders, signals] =
    await Promise.all([
      getProfile(userId),
      getMembership(userId),
      listWatchlists(userId),
      listTrackedSymbols(userId),
      countSaved(userId),
      unreadCount(userId),
      memberResearch.dashboard(),
      memberResearch.insiders({ limit: 5, openMarketOnly: true }),
      memberResearch.signals({ limit: 5 }),
    ]);

  const firstName = (profile?.displayName ?? session.user.name).split(" ")[0];

  // The dashboard aggregate is the contract's preferred source. It is not served
  // yet, so when it is unavailable the same page falls back to the feeds rather
  // than showing an empty workspace.
  const dashboardLive = dashboard.provenance !== "unavailable";
  const counts = dashboardLive
    ? dashboard.data.counts
    : {
        filings: insiders.data.total,
        transactions: insiders.data.total,
        signals: signals.data.total,
        institutions: 0,
        holdings: 0,
        symbols: 0,
      };
  const topSignals = dashboardLive ? dashboard.data.topSignals : signals.data.items;
  const recentPurchases = dashboardLive ? dashboard.data.recentPurchases : insiders.data.items;
  const caveats = dashboardLive ? dashboard.data.caveats : [];

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
            {tracked.map((symbol) => (
              <li key={symbol}>
                <Link
                  href={`/app/assets/${encodeURIComponent(symbol)}`}
                  className="inline-flex items-center rounded-md border border-mk-line bg-mk-raised px-2.5 py-1.5 font-marketing-mono text-xs text-mk-fg transition-colors hover:border-mk-accent/40 hover:text-mk-accent"
                >
                  {symbol}
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
              <EmptyState
                title="No insider filings available"
                description="Open-market insider filings will appear here once the research engine has published them."
              />
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
              <EmptyState
                title="No signals published"
                description="Signals appear once the engine has enough filings to measure activity against a baseline."
              />
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
        provenance={dashboardLive ? dashboard.provenance : insiders.provenance}
        generatedAt={dashboardLive ? dashboard.generatedAt : insiders.generatedAt}
        warnings={[
          ...(dashboardLive ? dashboard.warnings : [...insiders.warnings, ...signals.warnings]),
          ...caveats,
        ].slice(0, 3)}
      />
    </div>
  );
}
