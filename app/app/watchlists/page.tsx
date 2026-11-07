import type { Metadata } from "next";

import { PageHeader } from "@/components/member/ui";
import { WatchlistManager } from "@/components/member/watchlist-manager";
import { getMembership } from "@/lib/member/membership";
import { requireMember } from "@/lib/member/session";
import { ensureDefaultWatchlist, listWatchlists } from "@/lib/member/watchlists";

export const metadata: Metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const session = await requireMember("/app/watchlists");
  const userId = session.user.id;

  await ensureDefaultWatchlist(userId);

  const [watchlists, membership] = await Promise.all([listWatchlists(userId), getMembership(userId)]);

  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Watchlists"
        description="Group the tickers you follow. Every symbol you track feeds the insider and signal views."
      />
      <WatchlistManager
        initial={watchlists}
        maxWatchlists={membership.limits.watchlists}
        planLabel={membership.label}
      />
    </div>
  );
}
