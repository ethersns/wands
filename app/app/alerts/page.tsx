import type { Metadata } from "next";

import { AlertRuleManager } from "@/components/member/alert-rule-manager";
import { PageHeader } from "@/components/member/ui";
import { listRules } from "@/lib/member/alerts";
import { getMembership } from "@/lib/member/membership";
import { requireMember } from "@/lib/member/session";
import { listTrackedSymbols } from "@/lib/member/watchlists";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const session = await requireMember("/app/alerts");
  const userId = session.user.id;

  const [rules, membership, tracked] = await Promise.all([
    listRules(userId),
    getMembership(userId),
    listTrackedSymbols(userId),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Alerts"
        title="Alert rules"
        description="Standing questions about the tickers you track. A rule is checked when you ask for a check, and anything it finds becomes a notification in this workspace. Nothing is sent by email."
      />
      <AlertRuleManager
        initial={{ rules, limits: { used: rules.length, max: membership.limits.alertRules } }}
        planLabel={membership.label}
        trackedCount={tracked.length}
      />
    </div>
  );
}
