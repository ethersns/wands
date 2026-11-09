import { handleMemberRoute, readJson, requireMemberApi } from "@/lib/member/api";
import { addWatchlistItemSchema } from "@/lib/member/validation";
import { addWatchlistItem } from "@/lib/member/watchlists";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const { id } = await params;
    const { symbol, marketType, note } = addWatchlistItemSchema.parse(await readJson(request));

    const item = await addWatchlistItem(userId, id, symbol, marketType, note);
    if (!item) return { error: "That watchlist was not found." };
    return { item };
  });
}
