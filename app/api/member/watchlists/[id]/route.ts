import { handleMemberRoute, readJson, requireEntitledMemberApi } from "@/lib/member/api";
import { renameWatchlistSchema } from "@/lib/member/validation";
import { deleteWatchlist, renameWatchlist } from "@/lib/member/watchlists";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const { id } = await params;
    const { name } = renameWatchlistSchema.parse(await readJson(request));

    const renamed = await renameWatchlist(userId, id, name);
    if (!renamed) return { error: "That watchlist was not found." };
    return { ok: true };
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const { id } = await params;

    const deleted = await deleteWatchlist(userId, id);
    if (!deleted) return { error: "The default watchlist cannot be removed." };
    return { ok: true };
  });
}
