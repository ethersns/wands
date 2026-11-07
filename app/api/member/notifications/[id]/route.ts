import { handleMemberRoute, MemberError, requireMemberApi } from "@/lib/member/api";
import { markRead } from "@/lib/member/notifications";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(_request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireMemberApi();
    const { id } = await params;

    const marked = await markRead(userId, id);
    if (!marked) throw new MemberError("That notification was not found.", 404);
    return { ok: true };
  });
}
