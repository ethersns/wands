import { handleMemberRoute, readJson, requireMemberApi } from "@/lib/member/api";
import { deleteMemberAccount } from "@/lib/member/account";
import { ensureProfile, updateProfile } from "@/lib/member/profile";
import { accountUpdateSchema } from "@/lib/member/validation";

export async function PATCH(request: Request) {
  return handleMemberRoute(async () => {
    const actor = await requireMemberApi();
    const { displayName } = accountUpdateSchema.parse(await readJson(request));

    await ensureProfile(actor.userId, actor.name);
    return { profile: await updateProfile(actor.userId, { displayName }) };
  });
}

export async function DELETE() {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    await deleteMemberAccount(userId);
    return { ok: true };
  });
}
