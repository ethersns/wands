import { handleMemberRoute, MemberError, readJson, requireMemberApi } from "@/lib/member/api";
import { deleteSaved, updateSavedNote } from "@/lib/member/saved";
import { updateSavedNoteSchema } from "@/lib/member/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const { id } = await params;
    const { note } = updateSavedNoteSchema.parse(await readJson(request));

    const item = await updateSavedNote(userId, id, note ?? "");
    if (!item) throw new MemberError("That saved item was not found.", 404);
    return { item };
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const { id } = await params;

    const removed = await deleteSaved(userId, id);
    if (!removed) throw new MemberError("That saved item was not found.", 404);
    return { ok: true };
  });
}
