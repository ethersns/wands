import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Globe,
  Inbox,
  ServerCog,
  Users,
} from "lucide-react";

import { Kpi } from "@/components/admin/kpi";
import { RangePicker } from "@/components/admin/range-picker";
import { TrendChart } from "@/components/admin/trend-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { requireOperator } from "@/lib/admin/guard";
import { getOverview } from "@/lib/admin/metrics";
import { resolveRange, timezoneLabel } from "@/lib/admin/period";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Business overview",
};

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/dashboard/members",
    label: "Members",
    description: "Accounts, plans and onboarding",
    icon: Users,
  },
  {
    href: "/dashboard/waitlist",
    label: "Waitlist",
    description: "Early-access signups and export",
    icon: Inbox,
  },
  {
    href: "/dashboard/traffic",
    label: "Traffic",
    description: "Page views, referrers and campaigns",
    icon: Globe,
  },
  {
    href: "/dashboard/activity",
    label: "Activity",
    description: "Registrations, sign-ins and engagement",
    icon: Activity,
  },
  {
    href: "/dashboard/system",
    label: "System health",
    description: "Engine, data and collection status",
    icon: ServerCog,
  },
];

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireOperator("/dashboard");

  const params = await searchParams;
  const range = resolveRange(params);
  const overview = await getOverview(range);

  const onboardingRate =
    overview.onboarding.total > 0
      ? (overview.onboarding.completed / overview.onboarding.total) * 100
      : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {range.label} · {timezoneLabel()}
          </span>
        }
        title="Business overview"
        description="Genuine member, waitlist and traffic figures read from the Wands database. Nothing here is estimated."
        actions={
          <Link
            href="/dashboard/members"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            Members
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      />

      <RangePicker range={range} basePath="/dashboard" />

      {overview.degraded ? (
        <div
          role="status"
          className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-[12px] text-foreground"
        >
          The business database could not be read, so these figures are
          unavailable rather than zero. Check the connection in{" "}
          <Link href="/dashboard/system" className="underline underline-offset-2">
            System health
          </Link>
          .
        </div>
      ) : null}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Total members"
          value={formatNumber(overview.members.total)}
          footnote={
            overview.members.firstAt
              ? `since ${formatDate(overview.members.firstAt)}`
              : "no accounts yet"
          }
        />
        <Kpi
          label="New today"
          value={formatNumber(overview.members.today)}
          footnote={timezoneLabel()}
        />
        <Kpi
          label={`New in ${range.label.toLowerCase()}`}
          value={formatNumber(overview.members.window.current)}
          delta={overview.members.window.change}
          deltaLabel={`vs ${overview.members.window.previous} previous`}
        />
        <Kpi
          label="Waitlist signups"
          value={formatNumber(overview.waitlist.total)}
          delta={overview.waitlist.window.change}
          deltaLabel={`${overview.waitlist.window.current} in range`}
        />
        <Kpi
          label="Unique visitors"
          value={formatNumber(overview.traffic.visitors)}
          tracked={overview.traffic.tracked}
          footnote={
            overview.traffic.since ? `tracking since ${overview.traffic.since}` : undefined
          }
          hint={overview.traffic.tracked ? undefined : "Collection starts on the next public page view."}
        />
        <Kpi
          label="Page views"
          value={formatNumber(overview.traffic.views)}
          tracked={overview.traffic.tracked}
          footnote={overview.traffic.tracked ? "operator traffic excluded" : undefined}
        />
        <Kpi
          label="Sign-ins recorded"
          value={formatNumber(overview.signIns.window)}
          tracked={overview.signIns.tracked}
          footnote={
            overview.signIns.since ? `since ${overview.signIns.since}` : undefined
          }
          hint={
            overview.signIns.tracked
              ? undefined
              : "Recorded from the next successful member sign-in."
          }
        />
        <Kpi
          label="Active sessions"
          value={formatNumber(overview.signIns.activeSessions)}
          footnote="unexpired member sessions"
        />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Member registrations"
          description={`Accounts created per day · ${range.label.toLowerCase()}`}
        >
          <TrendChart
            data={overview.registrations}
            label="Registrations"
            emptyLabel="No accounts were created in this window."
          />
        </SectionCard>

        <SectionCard
          title="Successful sign-ins"
          description={
            overview.signIns.tracked
              ? `Recorded sign-ins per day · since ${overview.signIns.since}`
              : "Sign-in history begins with the next successful sign-in."
          }
        >
          <TrendChart
            data={overview.signInSeries}
            label="Sign-ins"
            color="var(--profit)"
            emptyLabel={
              overview.signIns.tracked
                ? "No sign-ins were recorded in this window."
                : "Not yet tracked — no sign-in has been recorded since collection began."
            }
          />
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          title="Membership distribution"
          description="Plan and status as recorded in member_membership."
        >
          {overview.membership.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No memberships recorded"
              description="No member has a membership row yet."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.membership.map((slice) => {
                const total = overview.membership.reduce((sum, row) => sum + row.count, 0);
                const share = total > 0 ? (slice.count / total) * 100 : 0;
                return (
                  <li key={`${slice.plan}-${slice.status}`} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-foreground">
                        {slice.plan}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          {slice.status}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] tabular text-muted-foreground">
                        {slice.count}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(share, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Onboarding"
          description="Members who completed the onboarding flow."
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[26px] leading-none tabular text-foreground">
                {onboardingRate === null ? "—" : `${onboardingRate.toFixed(0)}%`}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {overview.onboarding.completed} of {overview.onboarding.total} profiles
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-profit"
                style={{ width: `${onboardingRate ?? 0}%` }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Counted from <span className="font-mono">member_profile.onboarding_completed</span>,
              not from the existence of a profile row.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Waitlist conversion"
          description="Waitlist emails that later became member accounts."
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[26px] leading-none tabular text-foreground">
                {overview.conversion.rate === null
                  ? "—"
                  : `${overview.conversion.rate.toFixed(0)}%`}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {overview.conversion.matched} of {overview.conversion.waitlistTotal} signups
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Matched on the normalised email the waitlist already stores. This is a
              recorded match, not a marketing attribution.
            </p>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Most visited pages"
          description="Public pages only. Operator traffic is excluded."
        >
          {overview.topPages.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={overview.traffic.tracked ? "No page views in range" : "Not yet tracked"}
              description={
                overview.traffic.tracked
                  ? "No public page was viewed in this window."
                  : "Traffic collection begins with the next public page view."
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {overview.topPages.map((page) => (
                <li key={page.path} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate font-mono text-[11px] text-foreground">
                    {page.path}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular text-muted-foreground">
                    {page.views} views · {page.visitors} visitors
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Traffic sources"
          description="Referrer category for recorded page views."
        >
          {overview.referrers.length === 0 ? (
            <EmptyState
              icon={Globe}
              title={overview.traffic.tracked ? "No referrers in range" : "Not yet tracked"}
              description={
                overview.traffic.tracked
                  ? "No page views were recorded in this window."
                  : "Traffic collection begins with the next public page view."
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {overview.referrers.map((row) => (
                <li key={row.category} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-[12px] text-foreground capitalize">{row.category}</span>
                  <span className="font-mono text-[11px] tabular text-muted-foreground">
                    {row.views}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Control centre"
        description="Deeper reporting lives in its own section so this page stays readable."
      >
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-foreground">
                      {section.label}
                    </span>
                    <span className="block text-[11px] leading-relaxed text-muted-foreground">
                      {section.description}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <p className="text-[10px] text-muted-foreground">
        Reporting timezone {timezoneLabel()} · generated {formatRelative(new Date().toISOString())}
      </p>
    </div>
  );
}
