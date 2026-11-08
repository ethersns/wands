import { handleMemberRoute, readJson, requireEntitledMemberApi } from "@/lib/member/api";
import { getMembership } from "@/lib/member/membership";
import { createWatchlistSchema } from "@/lib/member/validation";
import { countWatchlists, createWatchlist, ensureDefaultWatchlist, listWatchlists } from "@/lib/member/watchlists";

export async function GET() {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    await ensureDefaultWatchlist(userId);
    return { watchlists: await listWatchlists(userId) };
  });
}

export async function POST(request: Request) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const { name } = createWatchlistSchema.parse(await readJson(request));

    const [membership, existing] = await Promise.all([getMembership(userId), countWatchlists(userId)]);
    if (existing >= membership.limits.watchlists) {
      return { error: `Your ${membership.label} plan includes ${membership.limits.watchlists} watchlists.` };
    }

    return { watchlist: await createWatchlist(userId, name) };
  });
}
