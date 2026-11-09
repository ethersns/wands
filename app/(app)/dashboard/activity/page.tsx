import type { Metadata } from "next";
import { Activity, Bookmark, ListChecks, LogIn } from "lucide-react";

import { Kpi } from "@/components/admin/kpi";
import { RangePicker } from "@/components/admin/range-picker";
import { TrendChart } from "@/components/admin/trend-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { requireOperator } from "@/lib/admin/guard";
import { getActivity } from "@/lib/admin/activity";
import { resolveRange, timezoneLabel } from "@/lib/admin/period";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";

export const metadata: Metadata = {
  title: "Activity",
};

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireOperator("/dashboard/activity");

  const params = await searchParams;
  const range = resolveRange(params);
  const activity = await getActivity(range);

  const onboardingRate =
    activity.totals.onboardingStarted > 0
      ? (activity.totals.onboardingCompleted / activity.totals.onboardingStarted) * 100
      : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {range.label} · {timezoneLabel()}
          </span>
        }
        title="Registration and engagement"
        description="Four distinct events, counted separately: account created, onboarding completed, waitlist signup, and returning sign-in."
      />

      <RangePicker range={range} basePath="/dashboard/activity" />

      <section aria-label="Activity totals" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Registrations"
          value={formatNumber(activity.totals.registrations)}
          footnote={range.label.toLowerCase()}
        />
        <Kpi
          label="Sign-ins recorded"
          value={formatNumber(activity.totals.signIns)}
          tracked={activity.signInTracked}
          footnote={activity.signInSince ? `since ${activity.signInSince}` : undefined}
          hint={
            activity.signInTracked
              ? undefined
              : "Recorded from the next successful member sign-in."
          }
        />
        <Kpi
          label="Active members"
          value={formatNumber(activity.totals.activeMembers)}
          tracked={activity.signInTracked}
          footnote={activity.signInTracked ? "signed in at least once" : undefined}
        />
        <Kpi
          label="Onboarding completion"
          value={onboardingRate === null ? "—" : `${onboardingRate.toFixed(0)}%`}
          footnote={`${activity.totals.onboardingCompleted} of ${activity.totals.onboardingStarted} profiles`}
        />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Daily registrations"
          description="Accounts created per day in the reporting timezone."
        >
          <TrendChart
            data={activity.registrations}
            label="Registrations"
            emptyLabel="No accounts were created in this window."
          />
        </SectionCard>

        <SectionCard
          title="Successful sign-ins"
          description={
            activity.signInTracked
              ? `Recorded sign-ins per day · since ${activity.signInSince}`
              : "Sign-in history begins with the next successful sign-in."
          }
        >
          <TrendChart
            data={activity.signIns}
            label="Sign-ins"
            color="var(--profit)"
            emptyLabel={
              activity.signInTracked
                ? "No sign-ins were recorded in this window."
                : "Not yet tracked."
            }
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Active members per day"
        description="An active member is an account that recorded at least one successful sign-in that day. A database row alone is not activity."
      >
        <TrendChart
          data={activity.activeMembers}
          label="Active members"
          color="var(--warning)"
          emptyLabel={
            activity.signInTracked
              ? "No member signed in during this window."
              : "Not yet tracked — activity is measured from recorded sign-ins."
          }
        />
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Engagement"
          description="First-party actions recorded in the member workspace."
        >
          <dl className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
                Watchlist items added
              </dt>
              <dd className="font-mono text-[18px] tabular text-foreground">
                {formatNumber(activity.engagement.watchlistItems)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
                Research saved
              </dt>
              <dd className="font-mono text-[18px] tabular text-foreground">
                {formatNumber(activity.engagement.savedItems)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
                Members adding to a watchlist
              </dt>
              <dd className="font-mono text-[18px] tabular text-foreground">
                {formatNumber(activity.engagement.watchlistCreators)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
                Members saving research
              </dt>
              <dd className="font-mono text-[18px] tabular text-foreground">
                {formatNumber(activity.engagement.savedCreators)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Counted from row timestamps inside the window, not from the existence of a
            record. The content of private research notes is never read.
          </p>
        </SectionCard>

        <SectionCard
          title="Recent sign-ins"
          description="The ten most recent recorded sign-ins."
        >
          {activity.recentSignIns.length === 0 ? (
            <EmptyState
              icon={LogIn}
              title="No sign-ins recorded"
              description="Sign-in history begins with the next successful member sign-in."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {activity.recentSignIns.map((row, index) => (
                <li
                  key={`${row.user_id}-${row.occurred_at}-${index}`}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="truncate font-mono text-[11px] text-foreground">
                    {row.email ?? row.user_id}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[10px] text-muted-foreground"
                    title={formatDateTime(row.occurred_at)}
                  >
                    {formatRelative(row.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="What is not measured"
        description="Stated explicitly so a blank panel is never mistaken for zero usage."
      >
        <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            <span className="inline-flex items-center gap-1 text-foreground">
              <ListChecks className="size-3" aria-hidden /> Quant Lab and Opportunity Desk usage
            </span>{" "}
            are not instrumented. Those surfaces do not record a per-member usage event, and
            inventing one from page views would be a guess.
          </li>
          <li>
            <span className="inline-flex items-center gap-1 text-foreground">
              <Bookmark className="size-3" aria-hidden /> Returning-visitor behaviour
            </span>{" "}
            is not tracked across days, by design — the traffic digest rotates daily.
          </li>
          <li>
            <span className="inline-flex items-center gap-1 text-foreground">
              <Activity className="size-3" aria-hidden /> Failed sign-in attempts
            </span>{" "}
            are not counted as activity, so automated attempts cannot inflate the numbers.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
