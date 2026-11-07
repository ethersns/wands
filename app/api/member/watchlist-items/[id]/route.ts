import { handleMemberRoute, requireMemberApi } from "@/lib/member/api";
import { removeWatchlistItem } from "@/lib/member/watchlists";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const { id } = await params;

    const removed = await removeWatchlistItem(userId, id);
    if (!removed) return { error: "That symbol was not on the watchlist." };
    return { ok: true };
  });
}
