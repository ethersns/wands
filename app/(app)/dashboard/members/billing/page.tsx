import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Receipt } from "lucide-react";

import { AccountStatusBadge, MembershipStatusBadge } from "@/components/admin/account-status-badge";
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
  recentBillingEvents,
  upcomingRenewals,
} from "@/lib/admin/billing";
import { requireOperator } from "@/lib/admin/guard";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Billing",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireOperator("/dashboard/members/billing");

  const [summary, billing, events, renewals] = await Promise.all([
    getBillingSummary(),
    listBilling({ pageSize: 50 }),
    recentBillingEvents(10),
    upcomingRenewals(8),
  ]);

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

      <section aria-label="Billing totals" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Memberships"
          value={formatNumber(summary.total)}
          footnote="rows in member_membership"
        />
        <Kpi
          label="Paying"
          value={formatNumber(summary.paying)}
          footnote={`${formatNumber(summary.trialing)} trialing`}
        />
        <Kpi
          label="Comped"
          value={formatNumber(summary.comped)}
          footnote="non-free, no subscription"
        />
        <Kpi
          label="Past due"
          value={formatNumber(summary.pastDue)}
          footnote={summary.pastDue > 0 ? "needs attention" : "none"}
        />
      </section>

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

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Deleting a member never deletes billing history. A live Stripe subscription blocks account
        deletion until it is cancelled in Stripe, so a paying customer cannot be removed by
        accident.
      </p>
    </div>
  );
}
