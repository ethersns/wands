import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Link2, Receipt, TriangleAlert } from "lucide-react";

import { AccountStatusBadge, MembershipStatusBadge } from "@/components/admin/account-status-badge";
import { ActivationLinkActions } from "@/components/admin/activation-link-actions";
import { Kpi } from "@/components/admin/kpi";
import { MemberTabs } from "@/components/admin/member-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getBillingSummary,
  listBilling,
  listRetainedBillingReferences,
  listSignupIntents,
  recentBillingEvents,
  upcomingRenewals,
} from "@/lib/admin/billing";
import { listPendingActivations } from "@/lib/admin/activation-links";
import { requireOperator } from "@/lib/admin/guard";
import { emailDeliveryConfigured } from "@/lib/email/send";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Billing",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireOperator("/dashboard/members/billing");

  const [summary, billing, events, renewals, retained, signups, pending] = await Promise.all([
    getBillingSummary(),
    listBilling({ pageSize: 50 }),
    recentBillingEvents(10),
    upcomingRenewals(8),
    listRetainedBillingReferences(25),
    listSignupIntents(25),
    listPendingActivations(25),
  ]);

  const mrrLabel =
    summary.mrr.length === 0
      ? "—"
      : summary.mrr
          .map((line) =>
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: line.currency.toUpperCase(),
              maximumFractionDigits: 0,
            }).format(line.amountMinor / 100),
          )
          .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Billing"
        description="Membership state as the Stripe webhook recorded it. This view is read-only: a paid tier is only ever the result of a signed webhook, never a change made here."
        actions={
          <span
            className={
              summary.billingEnabled
                ? "rounded-md border border-profit/30 bg-profit/10 px-2.5 py-1.5 text-[11px] font-medium text-profit"
                : "rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground"
            }
          >
            {summary.billingEnabled ? "Billing enabled" : "Billing disabled"}
          </span>
        }
      />

      <MemberTabs />

      <section
        aria-label="Billing totals"
        className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-6"
      >
        <Kpi
          label="MRR"
          value={mrrLabel}
          footnote="from Stripe subscriptions only"
        />
        <Kpi
          label="Paying"
          value={formatNumber(summary.paying)}
          footnote={`${formatNumber(summary.trialing)} trialing`}
        />
        <Kpi
          label="Pending payment"
          value={formatNumber(summary.pendingPayment)}
          footnote="checkout started, unpaid"
        />
        <Kpi
          label="Pending activation"
          value={formatNumber(summary.pendingActivation)}
          footnote="paid, not activated"
        />
        <Kpi
          label="Past due"
          value={formatNumber(summary.pastDue)}
          footnote={summary.pastDue > 0 ? "needs attention" : "none"}
        />
        <Kpi
          label="Comped"
          value={formatNumber(summary.comped)}
          footnote="owner grant, not revenue"
        />
      </section>

      <SectionCard
        title="Signup funnel"
        description="Every checkout that was started, including the ones that never became accounts. A manually assigned plan is not counted as revenue anywhere on this page."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {signups.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={CreditCard}
              title="No signups yet"
              description="A row appears here as soon as someone starts a checkout."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Activated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signups.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-[11px] text-foreground">
                      {row.email}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-foreground">
                      {row.plan}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.status === "activated"
                            ? "rounded-md border border-profit/30 bg-profit/10 px-2 py-0.5 text-[10px] font-medium text-profit"
                            : row.status === "paid"
                              ? "rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
                              : row.status === "pending"
                                ? "rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                : "rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive"
                        }
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.paid_at ? formatDateTime(row.paid_at) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.activated_at ? formatDateTime(row.activated_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Pending activations"
        description="Paid signups that have not become accounts yet. The activation link is stored only as a hash, so an existing link cannot be read back — issuing a new one replaces it."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {!emailDeliveryConfigured ? (
          <div className="mx-4 mb-3 flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 sm:mx-5">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <p className="text-[11px] leading-relaxed text-foreground">
              Email delivery is not configured on this deployment, so activation links are never
              sent automatically. Issue a link here and pass it to the customer yourself.
            </p>
          </div>
        ) : null}

        {pending.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Link2}
              title="Nothing waiting"
              description="Every paid signup has become an account."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead className="text-right">Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((row) => (
                  <TableRow key={row.intentId}>
                    <TableCell className="font-mono text-[11px] text-foreground">
                      {row.email}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-foreground">
                      {row.plan}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.paidAt ? formatDateTime(row.paidAt) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.liveLinkExpiresAt ? (
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground">
                          live · expires {formatRelative(row.liveLinkExpiresAt)}
                        </span>
                      ) : (
                        <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-warning">
                          no live link
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ActivationLinkActions
                          intentId={row.intentId}
                          email={row.email}
                          hasLiveLink={Boolean(row.liveLinkExpiresAt)}
                          emailConfigured={emailDeliveryConfigured}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="By tier" description="Every membership row, grouped by plan.">
          {summary.byPlan.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No memberships"
              description="No membership rows exist yet."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {summary.byPlan.map((row) => (
                <li key={row.plan} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-[12px] text-foreground">{row.plan}</span>
                  <span className="font-mono text-[11px] tabular text-muted-foreground">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="By status" description="Subscription state as recorded.">
          {summary.byStatus.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No statuses"
              description="No membership rows exist yet."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {summary.byStatus.map((row) => (
                <li key={row.status} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-[12px] text-foreground capitalize">
                    {row.status.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[11px] tabular text-muted-foreground">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Renewals in 30 days" description="Active and trialing periods ending soon.">
          {renewals.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing due"
              description="No subscription period ends in the next 30 days."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {renewals.map((row) => (
                <li key={row.user_id} className="flex items-center justify-between gap-3 py-1.5">
                  <Link
                    href={`/dashboard/members/${row.user_id}`}
                    className="min-w-0 truncate font-mono text-[11px] text-foreground hover:underline"
                  >
                    {row.email}
                  </Link>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatDate(row.current_period_end)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Memberships"
        description="Card numbers, expiry dates and CVCs are never stored by this application and are not shown here."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {billing.rows.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={CreditCard}
              title="No memberships"
              description="Membership rows appear once a member completes onboarding."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entitlement</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Stripe customer</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.rows.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/members/${row.user_id}`}
                        className="flex flex-col gap-0.5 hover:underline"
                      >
                        <span className="text-[12px] font-medium text-foreground">
                          {row.display_name || row.email}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {row.email}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-foreground">
                      {row.plan}
                    </TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.entitlement_source === "stripe"
                        ? row.cancel_at_period_end
                          ? "stripe · cancelling"
                          : "stripe"
                        : row.entitlement_source}
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge status={row.account_status} />
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.current_period_end ? formatDate(row.current_period_end) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {row.stripe_customer_id ? `${row.stripe_customer_id.slice(0, 14)}…` : "—"}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent webhook deliveries"
        description="Event type and time only. The payload is not read, because it can contain a customer's address and payment-method metadata."
      >
        {events.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No webhook events"
            description="No Stripe event has been received on this deployment."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate font-mono text-[11px] text-foreground">{event.type}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatDateTime(event.received_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Retained billing references"
        description="Accounts that were deleted while holding a Stripe reference. Kept here, separately from the audit log, so a charge stays traceable without the audit trail becoming a record of payment identities."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {retained.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={Receipt}
              title="Nothing retained"
              description="No account has been deleted while holding a Stripe reference."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stripe customer</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status at deletion</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retained.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-[10px] text-foreground">
                      {row.stripe_customer_id ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {row.stripe_subscription_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-foreground">
                      {row.plan ?? "—"}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.membership_status ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.deleted_at)}
                    </TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {row.deleted_by}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Deleting a member never deletes billing history. A live Stripe subscription blocks account
        deletion until it is cancelled in Stripe, so a paying customer cannot be removed by
        accident. The audit row for a deletion records what was removed and a reference to the
        retained billing record, but not the account id, the address or the Stripe ids themselves.
      </p>
    </div>
  );
}
