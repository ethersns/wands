import type { Metadata } from "next";
import { ScrollText, ServerCog, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { recentAdminActions } from "@/lib/admin/audit";
import { requireOperator } from "@/lib/admin/guard";
import { getHealth, type HealthState } from "@/lib/admin/health";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { StatusTone } from "@/lib/status";

export const metadata: Metadata = {
  title: "System health",
};

export const dynamic = "force-dynamic";

const TONE: Record<HealthState, StatusTone> = {
  ok: "profit",
  degraded: "warning",
  down: "loss",
  unknown: "muted",
};

const LABEL: Record<HealthState, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

export default async function SystemPage() {
  await requireOperator("/dashboard/system");

  const [health, audit] = await Promise.all([getHealth(), recentAdminActions(15)]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="System health"
        description="Each check reports what actually answered. A page that rendered is not evidence that a service is up."
      />

      <section aria-label="Service checks" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {health.checks.map((check) => (
          <div
            key={check.id}
            className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground">{check.label}</span>
              <StatusChip label={LABEL[check.state]} tone={TONE[check.state]} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{check.detail}</p>
            {check.observedAt ? (
              <span className="font-mono text-[10px] text-muted-foreground/80">
                observed {formatRelative(check.observedAt)}
              </span>
            ) : null}
          </div>
        ))}
      </section>

      <SectionCard
        title="Background collection"
        description="Scheduled intelligence jobs and their last recorded outcome."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {health.jobs.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ServerCog}
              title="No jobs registered"
              description="No background collection job is configured in intel_jobs."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last status</TableHead>
                <TableHead>Last finished</TableHead>
                <TableHead className="text-right">Consecutive failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.jobs.map((job) => (
                <TableRow key={job.name}>
                  <TableCell className="font-mono text-[11px] text-foreground">{job.name}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {job.paused ? "Paused" : job.enabled ? "Yes" : "No"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        job.lastStatus === "ok" || job.lastStatus === "success"
                          ? "text-[11px] text-profit"
                          : job.lastStatus
                            ? "text-[11px] text-warning"
                            : "text-[11px] text-muted-foreground"
                      }
                    >
                      {job.lastStatus ?? "never run"}
                    </span>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {job.lastFinishedAt ? formatRelative(job.lastFinishedAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                    {job.consecutiveFailures}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Recent collection errors"
        description="Truncated messages. No connection strings, tokens or stack traces are shown."
      >
        {health.failures.length === 0 ? (
          <EmptyState
            icon={TriangleAlert}
            title="No recent failures"
            description="No background job has recorded a failure."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {health.failures.map((failure, index) => (
              <li key={`${failure.jobName}-${failure.occurredAt}-${index}`} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-foreground">{failure.jobName}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatDateTime(failure.occurredAt)}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="text-warning">{failure.errorType}</span>
                  {failure.message ? ` · ${failure.message}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Administrative audit trail"
        description="Sensitive admin actions, including every waitlist export."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {audit.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ScrollText}
              title="No admin actions recorded"
              description="Sensitive actions such as a CSV export will be logged here."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {formatDateTime(entry.occurred_at)}
                  </TableCell>
                  <TableCell className="text-[11px] text-foreground">{entry.actor}</TableCell>
                  <TableCell className="font-mono text-[11px] text-foreground">
                    {entry.action}
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {entry.target ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(entry.detail)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
