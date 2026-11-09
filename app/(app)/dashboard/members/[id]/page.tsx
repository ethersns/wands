import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, Eye, ListChecks, ShieldCheck } from "lucide-react";

import { AccountStatusBadge, MembershipStatusBadge } from "@/components/admin/account-status-badge";
import { ActionFlash } from "@/components/admin/action-flash";
import { MemberActions } from "@/components/admin/member-actions";
import { MemberTabs } from "@/components/admin/member-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { requireOperator } from "@/lib/admin/guard";
import { getMember } from "@/lib/admin/members";
import { securityEventLabel } from "@/lib/admin/security";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Member detail",
};

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-[12px] text-foreground">{value}</dd>
    </div>
  );
}

function NotRecorded() {
  return <span className="text-muted-foreground">Not recorded</span>;
}

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reactivated?: string }>;
}) {
  const { id } = await params;
  await requireOperator(`/dashboard/members/${id}`);

  const member = await getMember(id);

  if (!member) notFound();

  const suspended = member.account_status === "suspended";
  const { reactivated } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/members"
        className="inline-flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden />
        All members
      </Link>

      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <AccountStatusBadge status={member.account_status} />
            <MembershipStatusBadge status={member.status} />
          </span>
        }
        title={member.display_name || member.name || member.email}
        description={member.email}
        actions={
          <MemberActions
            userId={member.id}
            email={member.email}
            status={member.account_status}
            returnTo={`/dashboard/members/${member.id}`}
          />
        }
      />

      <MemberTabs />

      {reactivated ? (
        <ActionFlash
          dismissHref={`/dashboard/members/${member.id}`}
          message={`${member.email} was reactivated and can sign in again.`}
        />
      ) : null}

      {suspended ? (
        <section
          aria-label="Suspension detail"
          className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 sm:px-5"
        >
          <h2 className="text-[12px] font-medium text-destructive">Account suspended</h2>
          <dl className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field
              label="Suspended"
              value={
                member.suspended_at ? (
                  <span title={formatDateTime(member.suspended_at)}>
                    {formatRelative(member.suspended_at)}
                  </span>
                ) : (
                  <NotRecorded />
                )
              }
            />
            <Field label="By" value={member.suspended_by ?? <NotRecorded />} />
            <Field label="Reason" value={member.suspension_reason ?? <NotRecorded />} />
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Sign-in is refused at the authentication layer and every session was revoked. The
            account&apos;s data is intact and reactivation restores access.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Account" description="Identity and registration.">
          <dl className="grid grid-cols-2 gap-3">
            <Field
              label="Account ID"
              value={<span className="font-mono text-[10px] break-all">{member.id}</span>}
            />
            <Field label="Registered" value={formatDate(member.created_at)} />
            <Field
              label="Email verified"
              value={
                <span className={member.email_verified ? "text-profit" : "text-muted-foreground"}>
                  {member.email_verified ? "Verified" : "Unverified"}
                </span>
              }
            />
            <Field
              label="Last sign-in"
              value={
                member.last_login_at ? (
                  <span title={formatDateTime(member.last_login_at)}>
                    {formatRelative(member.last_login_at)}
                  </span>
                ) : (
                  <NotRecorded />
                )
              }
            />
            <Field label="Active sessions" value={member.session_count} />
            <Field
              label="Last IP"
              value={
                member.last_ip ? (
                  <span className="font-mono text-[11px]">{member.last_ip}</span>
                ) : (
                  <NotRecorded />
                )
              }
            />
          </dl>
        </SectionCard>

        <SectionCard title="Membership" description="As recorded in member_membership.">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Tier" value={member.plan ?? "—"} />
            <Field label="Status" value={member.status ?? "—"} />
            <Field
              label="Period end"
              value={member.current_period_end ? formatDate(member.current_period_end) : "—"}
            />
            <Field
              label="Updated"
              value={
                member.membership_updated_at ? formatRelative(member.membership_updated_at) : "—"
              }
            />
            <Field
              label="Stripe customer"
              value={
                member.stripe_customer_id ? (
                  <span className="font-mono text-[10px] break-all">
                    {member.stripe_customer_id}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Subscription"
              value={
                member.stripe_subscription_id ? (
                  <span className="font-mono text-[10px] break-all">
                    {member.stripe_subscription_id}
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </SectionCard>

        <SectionCard title="Profile and notifications" description="Onboarding and preferences.">
          <dl className="grid grid-cols-2 gap-3">
            <Field
              label="Onboarding"
              value={
                <span className={member.onboarding_completed ? "text-profit" : "text-muted-foreground"}>
                  {member.onboarding_completed ? "Complete" : "Incomplete"}
                </span>
              }
            />
            <Field label="Step" value={member.onboarding_step ?? "—"} />
            <Field label="Experience" value={member.experience ?? "—"} />
            <Field
              label="Interests"
              value={member.interests.length > 0 ? member.interests.join(", ") : "—"}
            />
            <Field
              label="Notifications"
              value={
                member.notification_prefs
                  ? [
                      member.notification_prefs.insider_activity && "insider",
                      member.notification_prefs.institutional_filings && "filings",
                      member.notification_prefs.asset_signals && "signals",
                      member.notification_prefs.product_updates && "product",
                    ]
                      .filter(Boolean)
                      .join(", ") || "all off"
                  : "not set"
              }
            />
          </dl>
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          title={`Watchlists (${member.watchlist_count})`}
          description="Names and item counts only. Item notes are not read."
        >
          {member.watchlists.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No watchlists"
              description="This member has not created a watchlist."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {member.watchlists.map((list) => (
                <li key={list.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-[12px] text-foreground">{list.name}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular text-muted-foreground">
                    {list.items} items · {formatDate(list.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={`Saved research (${member.saved_count})`}
          description="Titles and symbols. Private notes are deliberately excluded."
        >
          {member.saved.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title="Nothing saved"
              description="This member has not saved any research."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {member.saved.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-foreground">{item.title}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {item.kind}
                      {item.symbol ? ` · ${item.symbol}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatDate(item.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Sign-in history"
        description="Recorded from the point sign-in tracking began. Sign-outs do not remove these rows."
      >
        {member.logins.length === 0 ? (
          <EmptyState
            icon={Eye}
            title="No sign-ins recorded"
            description="Sign-in history begins with this member's next successful sign-in."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {member.logins.map((login, index) => (
              <li
                key={`${login.occurred_at}-${index}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5"
              >
                <span className="text-[12px] text-foreground">Successful sign-in</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {login.ip_address ?? "IP not recorded"}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDateTime(login.occurred_at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Security activity"
        description="Failed sign-ins, session revocations and account status changes."
      >
        {member.security_events.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No security events"
            description="Nothing has been recorded against this account."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {member.security_events.map((event, index) => (
              <li
                key={`${event.occurred_at}-${index}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[12px] text-foreground">
                    {securityEventLabel(event.kind)}
                  </span>
                  <span
                    className={
                      event.outcome === "failure"
                        ? "text-[10px] text-destructive"
                        : "text-[10px] text-muted-foreground"
                    }
                  >
                    {event.outcome}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {event.ip_address ?? "IP not recorded"}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDateTime(event.occurred_at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Password hashes, session tokens and reset tokens are never selected, and there is no way
        to sign in as this member from here. IP addresses are read from headers the hosting edge
        writes, never from a client-supplied forwarded header, and are pruned after 180 days.
      </p>
    </div>
  );
}
