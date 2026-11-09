import type { Metadata } from "next";
import Link from "next/link";

import {
  BillingPortalButton,
  StartMembershipButton,
} from "@/components/member/membership-actions";
import { Badge, PageHeader, Panel, formatDate } from "@/components/member/ui";
import {
  MEMBER_PLANS,
  billingBlockedReason,
  checkoutAvailableFor,
  formatMembershipPrice,
  getMembershipPrice,
} from "@/lib/billing/config";
import { entitlementMessage } from "@/lib/billing/entitlement";
import { getMembership } from "@/lib/member/membership";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Membership" };

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Payment failed",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  incomplete: "Incomplete",
  none: "No membership",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * The member billing surface.
 *
 * This is the one page under `/app` an unpaid account can still reach, which is
 * deliberate: a member whose subscription lapsed needs to see why and be able
 * to pay, and locking them out of the page that fixes it would be a dead end.
 * Everything it can do — open the portal, start a subscription — is authorised
 * on the server against the session, never against a value in the URL.
 */
export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await requireMember("/app/membership");
  const [membership, price] = await Promise.all([
    getMembership(session.user.id),
    getMembershipPrice("founding"),
  ]);

  const params = await searchParams;
  const plan = MEMBER_PLANS.founding;
  const canCheckout = checkoutAvailableFor("founding");
  const renewal = formatDate(membership.currentPeriodEnd);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Plan"
        title="Membership"
        description="What your account includes, what it costs, and how to change it."
      />

      {!membership.entitled ? (
        <Panel title="Activate your membership">
          <p className="text-sm leading-relaxed text-mk-fg text-pretty">
            {entitlementMessage(membership.reason)}
          </p>
          {params.from ? (
            <p className="mt-2 text-sm leading-relaxed text-mk-muted text-pretty">
              That page needs an active membership. Your watchlists, saved research
              and notes are all still here.
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-mk-line bg-mk-bg/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-base font-semibold text-mk-fg">
                {plan.name}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-mk-muted">
                {formatMembershipPrice(price)} · Billed monthly · No free trial
              </p>
            </div>
            <div className="shrink-0">
              {canCheckout ? (
                <StartMembershipButton />
              ) : (
                <p className="max-w-xs text-[12.5px] leading-relaxed text-mk-warn">
                  {billingBlockedReason ?? "Billing is not open yet."}
                </p>
              )}
            </div>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-mk-dim text-pretty">
            Secure billing through Stripe. Cancel according to the subscription
            terms shown at checkout.
          </p>
        </Panel>
      ) : null}

      <Panel title="Current plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-semibold text-mk-fg">
              {membership.complimentary
                ? `${membership.label} — Lifetime Complimentary`
                : membership.label}
            </p>
            <p className="mt-1 text-sm text-mk-muted">
              {membership.complimentary
                ? "Full access granted by the Wands team. No renewal, no payment method, no expiry."
                : membership.entitled
                  ? membership.cancelAtPeriodEnd
                    ? `Access ends ${renewal}`
                    : `Renews ${renewal}`
                  : "No payment method on file"}
            </p>
          </div>
          <Badge tone={membership.entitled ? "emerald" : "warn"}>
            {membership.complimentary ? "Active" : statusLabel(membership.status)}
          </Badge>
        </div>

        {membership.cancelAtPeriodEnd ? (
          <p className="mt-4 rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2.5 text-[13px] leading-relaxed text-mk-muted">
            Renewal is cancelled. You keep full access until {renewal}, and nothing
            further is charged. Resume from the billing portal if you change your
            mind.
          </p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-mk-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Watchlists
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.watchlists}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Saved items
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{membership.limits.savedItems}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Insider window
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {membership.limits.insiderWindowDays} days
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
              Institutional changes
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {membership.limits.institutionalChanges ? "Included" : "Not included"}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Billing">
        {membership.complimentary ? (
          <p className="text-sm leading-relaxed text-mk-muted text-pretty">
            This membership is complimentary and managed by the Wands team. There
            is no billing account, no payment method and nothing to cancel.
          </p>
        ) : membership.stripeCustomerId ? (
          <>
            <p className="text-sm leading-relaxed text-mk-fg text-pretty">
              Update your payment method, cancel renewal or resume a cancelled
              subscription in the Stripe billing portal.
            </p>
            <div className="mt-4">
              <BillingPortalButton />
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-mk-dim text-pretty">
              Card details are handled by Stripe and never stored by Wands.
            </p>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-mk-muted text-pretty">
            There is no billing account on this membership yet. Once a subscription
            is active, payment method changes and cancellation are handled here.
          </p>
        )}
      </Panel>

      <p className="text-[11.5px] leading-relaxed text-mk-dim text-pretty">
        Membership governs what your account may open. Research data itself comes
        from the Wands engine, and the workspace reports separately when that
        engine cannot be reached.
      </p>

      <p className="text-[11.5px] leading-relaxed text-mk-dim text-pretty">
        Need something else?{" "}
        <Link href="/contact" className="text-mk-accent underline-offset-4 hover:underline">
          Contact the team
        </Link>
        .
      </p>
    </div>
  );
}
