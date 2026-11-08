import { handleMemberRoute, readJson, requireEntitledMemberApi } from "@/lib/member/api";
import { deleteRule, updateRule } from "@/lib/member/alerts";
import { updateAlertRuleSchema } from "@/lib/member/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const { id } = await params;
    const patch = updateAlertRuleSchema.parse(await readJson(request));

    const rule = await updateRule(userId, id, patch);
    if (!rule) return { error: "That alert rule was not found." };
    return { rule };
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const { id } = await params;

    const deleted = await deleteRule(userId, id);
    if (!deleted) return { error: "That alert rule was not found." };
    return { ok: true };
  });
}
