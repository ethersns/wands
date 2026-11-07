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

  const [profile, membership, watchlists, tracked, savedCount, unread, status, insiders, signals] = await Promise.all([
    getProfile(userId),
    getMembership(userId),
    listWatchlists(userId),
    listTrackedSymbols(userId),
    countSaved(userId),
    unreadCount(userId),
    memberResearch.status(),
    memberResearch.insiderFeed({ limit: 5, openMarketOnly: true }),
    memberResearch.signals({ limit: 5 }),
  ]);

  const firstName = (profile?.displayName ?? session.user.name).split(" ")[0];
  const intel = status.data;

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
        <StatTile label="Tracked symbols" value={tracked.length} hint={`${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"}`} />
        <StatTile label="Saved research" value={savedCount} hint={`${membership.label} plan`} />
        <StatTile label="Unread alerts" value={unread} hint="In-app notifications" />
        <StatTile label="Filings indexed" value={intel.filings.toLocaleString()} hint={`${intel.transactions.toLocaleString()} transactions`} />
      </div>

      <Panel
        title="Tracked symbols"
        action={
          <Link href="/app/watchlists" className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline">
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
            <Link href="/app/insiders" className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline">
              All filings
            </Link>
          }
        >
          {insiders.data.items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No insider filings available"
                description="Open-market insider filings will appear here once the research engine has published them."
              />
            </div>
          ) : (
            <ul>
              {insiders.data.items.map((transaction) => (
                <InsiderRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest signals"
          bodyClassName="p-0"
          action={
            <Link href="/app/signals" className="text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline">
              All signals
            </Link>
          }
        >
          {signals.data.items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No signals published"
                description="Signals appear once the engine has enough filings to measure activity against a baseline."
              />
            </div>
          ) : (
            <ul>
              {signals.data.items.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ProvenanceNote
        provenance={status.provenance}
        generatedAt={status.generatedAt}
        warnings={[...status.warnings, ...intel.caveats].slice(0, 3)}
      />
    </div>
  );
}
