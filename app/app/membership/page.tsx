import type { Metadata } from "next";

import { Badge, PageHeader, Panel } from "@/components/member/ui";
import { PLAN_CATALOG, getMembership } from "@/lib/member/membership";
import { requireMember } from "@/lib/member/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Membership" };

export default async function MembershipPage() {
  const session = await requireMember("/app/membership");
  const membership = await getMembership(session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Plan"
        title="Membership"
        description="What your account includes today, and what each plan unlocks."
      />

      <Panel title="Current plan">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-xl font-semibold text-mk-fg">{membership.label}</p>
            <p className="mt-1 text-sm text-mk-muted">
              Status {membership.status}
              {membership.currentPeriodEnd ? ` · renews ${membership.currentPeriodEnd.slice(0, 10)}` : ""}
            </p>
          </div>
          <Badge tone="accent">{membership.plan}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-mk-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">Watchlists</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.watchlists}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">Saved items</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.savedItems}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">Insider window</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.insiderWindowDays} days</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">Institutional changes</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.institutionalChanges ? "Included" : "Not included"}</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Billing">
        <p className="text-sm leading-relaxed text-mk-fg text-pretty">
          {membership.billingEnabled
            ? "Billing is enabled for this workspace. Plan changes are handled through the billing portal."
            : "Billing is not enabled yet. Your plan is set by the Wands team, and no payment method is on file. Nothing on this page will charge you."}
        </p>
        {!membership.billingEnabled ? (
          <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">
            When billing opens, plan changes will appear here. Until then, contact the team if you need a different plan.
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        {PLAN_CATALOG.map((entry) => {
          const current = entry.plan === membership.plan;
          return (
            <section
              key={entry.plan}
              className={cn(
                "rounded-xl border p-4",
                current ? "border-mk-accent/40 bg-mk-accent-soft/40" : "border-mk-line bg-mk-surface/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-mk-fg">{entry.label}</h2>
                {current ? <Badge tone="accent">Current</Badge> : null}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-mk-muted text-pretty">{entry.blurb}</p>
              <ul className="mt-3 flex flex-col gap-1 font-marketing-mono text-[11px] text-mk-dim">
                <li>{entry.limits.watchlists} watchlists</li>
                <li>{entry.limits.savedItems} saved items</li>
                <li>{entry.limits.insiderWindowDays}-day insider window</li>
                <li>{entry.limits.institutionalChanges ? "Institutional changes" : "No institutional changes"}</li>
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
