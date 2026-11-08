import { handleMemberRoute, readJson, requireEntitledMemberApi } from "@/lib/member/api";
import { countRules, createRule, listRules } from "@/lib/member/alerts";
import { getMembership } from "@/lib/member/membership";
import { createAlertRuleSchema } from "@/lib/member/validation";

export async function GET() {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const [rules, membership] = await Promise.all([listRules(userId), getMembership(userId)]);

    return { rules, limits: { used: rules.length, max: membership.limits.alertRules } };
  });
}

export async function POST(request: Request) {
  return handleMemberRoute(async () => {
    const { userId } = await requireEntitledMemberApi();
    const input = createAlertRuleSchema.parse(await readJson(request));

    const [membership, existing] = await Promise.all([getMembership(userId), countRules(userId)]);
    if (existing >= membership.limits.alertRules) {
      return { error: `Your ${membership.label} plan includes ${membership.limits.alertRules} alert rules.` };
    }

    const rule = await createRule(userId, {
      kind: input.kind,
      symbol: input.symbol ?? null,
      minValue: input.minValue ?? null,
      minScore: input.minScore ?? null,
    });

    return { rule };
  });
}
