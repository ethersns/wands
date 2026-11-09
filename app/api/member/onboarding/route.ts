import { handleMemberRoute, readJson, requireMemberApi } from "@/lib/member/api";
import { ensureProfile, updateProfile } from "@/lib/member/profile";
import { onboardingSchema } from "@/lib/member/validation";
import { addWatchlistItem, ensureDefaultWatchlist } from "@/lib/member/watchlists";

export async function PATCH(request: Request) {
  return handleMemberRoute(async () => {
    const actor = await requireMemberApi();
    const input = onboardingSchema.parse(await readJson(request));

    await ensureProfile(actor.userId, actor.name);

    if (input.seedSymbols?.length) {
      const watchlist = await ensureDefaultWatchlist(actor.userId);
      for (const symbol of input.seedSymbols) {
        await addWatchlistItem(actor.userId, watchlist.id, symbol, "stocks");
      }
    }

    const profile = await updateProfile(actor.userId, {
      displayName: input.displayName,
      experience: input.experience,
      interests: input.interests,
      onboardingStep: input.step,
      onboardingCompleted: input.completed,
    });

    return { profile };
  });
}
