import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, Eye, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { requireOperator } from "@/lib/admin/guard";
import { getMember } from "@/lib/admin/members";
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

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOperator(`/dashboard/members/${id}`);

  const member = await getMember(id);

  if (!member) notFound();

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
        title={member.display_name || member.name || member.email}
        description={member.email}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Account" description="Identity and registration.">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Member ID" value={<span className="font-mono text-[10px] break-all">{member.id}</span>} />
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
                  <span className="text-muted-foreground">Not tracked</span>
                )
              }
            />
          </dl>
        </SectionCard>

        <SectionCard title="Membership" description="As recorded in member_membership.">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Plan" value={member.plan ?? "—"} />
            <Field label="Status" value={member.status ?? "—"} />
            <Field
              label="Period end"
              value={member.current_period_end ? formatDate(member.current_period_end) : "—"}
            />
            <Field
              label="Updated"
              value={member.membership_updated_at ? formatRelative(member.membership_updated_at) : "—"}
            />
          </dl>
        </SectionCard>

        <SectionCard title="Onboarding" description="Profile and stated interests.">
          <dl className="grid grid-cols-2 gap-3">
            <Field
              label="Completed"
              value={
                <span className={member.onboarding_completed ? "text-profit" : "text-muted-foreground"}>
                  {member.onboarding_completed ? "Yes" : "No"}
                </span>
              }
            />
            <Field label="Step" value={member.onboarding_step ?? "—"} />
            <Field label="Experience" value={member.experience ?? "—"} />
            <Field
              label="Interests"
              value={member.interests.length > 0 ? member.interests.join(", ") : "—"}
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
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="text-[12px] text-foreground">Successful sign-in</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatDateTime(login.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        This view is read-only. Password hashes, session tokens and reset tokens are
        never selected, and there is no way to sign in as this member from here.
      </p>
    </div>
  );
}
