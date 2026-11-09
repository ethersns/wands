import { handleMemberRoute, MemberError, readJson, requireEntitledMemberApi } from "@/lib/member/api";
import { getMembership } from "@/lib/member/membership";
import { countSaved, deleteSavedByRef, listSaved, saveItem } from "@/lib/member/saved";
import { saveItemSchema } from "@/lib/member/validation";

export async function GET() {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    return { items: await listSaved(userId) };
  });
}

export async function POST(request: Request) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const input = saveItemSchema.parse(await readJson(request));

    const [membership, existing] = await Promise.all([getMembership(userId), countSaved(userId)]);
    if (existing >= membership.limits.savedItems) {
      throw new MemberError(`Your ${membership.label} plan saves up to ${membership.limits.savedItems} items.`);
    }

    return { item: await saveItem(userId, input) };
  });
}

export async function DELETE(request: Request) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const refId = url.searchParams.get("refId");

    if (!kind || !refId) throw new MemberError("A saved item reference is required.");

    const removed = await deleteSavedByRef(userId, kind as "signal" | "filing" | "asset" | "insider", refId);
    if (!removed) throw new MemberError("That saved item was not found.", 404);
    return { ok: true };
  });
}
