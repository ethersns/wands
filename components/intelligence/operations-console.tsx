"use client";

import * as React from "react";
import { CalendarClock, CircleAlert, Cog, Lock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { CoverageWarning } from "./coverage-warning";
import { KeyValueList } from "./evidence-panel";
import { ActionOutcomePanel } from "./action-outcome-panel";
import { BackfillForm, JobPauseControl } from "./job-actions";
import type { ActionOutcome } from "@/lib/intelligence/action-outcome";
import type { IntelJob } from "@/lib/api/contracts";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { jobHealth, jobStatus, nextRunLabel } from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

function JobCard({
  job,
  onOutcome,
}: {
  job: IntelJob;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const status = jobStatus(job);
  const health = jobHealth(job);
  const nextRun = nextRunLabel(job.nextRunAt);
  const metrics = Object.entries(job.metrics);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[12px] font-medium text-foreground">
              {job.name}
            </h3>
            <StatusChip label={status.label} tone={status.tone} />
            <StatusChip label={health.label} tone={health.tone} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span>{job.kind}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-2.5" aria-hidden />
              every {formatDuration(job.scheduleSeconds)}
            </span>
            {!job.enabled ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-warning">disabled in config</span>
              </>
            ) : null}
          </p>
        </div>
        <JobPauseControl job={job} onOutcome={onOutcome} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <KeyValueList
            items={[
              {
                label: "Last started",
                value: job.lastStartedAt ? formatDateTime(job.lastStartedAt) : "never",
              },
              {
                label: "Last finished",
                value: job.lastFinishedAt ? formatDateTime(job.lastFinishedAt) : "never",
              },
              {
                label: "Next run",
                value: (
                  <span className={nextRun.overdue ? "text-warning" : undefined}>
                    {nextRun.label}
                  </span>
                ),
              },
              { label: "Last status", value: job.lastStatus || "—" },
            ]}
          />
          <KeyValueList
            items={[
              { label: "Total runs", value: formatNumber(job.totalRuns, { digits: 0 }) },
              {
                label: "Total failures",
                value: formatNumber(job.totalFailures, { digits: 0 }),
              },
              {
                label: "Consecutive failures",
                value: formatNumber(job.consecutiveFailures, { digits: 0 }),
              },
              {
                label: "Lease owner",
                value: job.leaseOwner ?? "not running",
              },
            ]}
          />
        </div>

        {job.lastError ? (
          <CoverageWarning
            severity={job.consecutiveFailures >= 3 ? "blocking" : "warning"}
            title="Last error"
          >
            <span className="font-mono text-[10px] break-words">{job.lastError}</span>
          </CoverageWarning>
        ) : null}

        {metrics.length > 0 ? (
          <details>
            <summary className="cursor-pointer list-none text-[10px] font-medium tracking-[0.04em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Run metrics ({metrics.length})
            </summary>
            <KeyValueList
              className="mt-2"
              columns={2}
              items={metrics.map(([key, value]) => ({
                label: key,
                value:
                  value === null || value === undefined
                    ? "—"
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value),
              }))}
            />
          </details>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The operations console.
 *
 * Authorisation is the engine's: this UI sends the request and renders the
 * answer. A refusal is shown as a refusal, and no action is reported as
 * successful before the engine has acknowledged it.
 */
export function OperationsConsole({
  jobs,
  schedulerEnabled,
  caveats,
}: {
  jobs: IntelJob[];
  schedulerEnabled: boolean;
  caveats: string[];
}) {
  const [outcome, setOutcome] = React.useState<ActionOutcome | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-[12px] font-medium text-foreground">
              Administrative actions are authorised by the engine
            </p>
            <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-pretty text-muted-foreground">
              Pause, resume and backfill require the admin role on the engine token.
              This interface cannot grant that role, and a refusal is shown exactly as
              the engine returned it.
            </p>
          </div>
        </div>
        <BackfillForm onOutcome={setOutcome} />
      </div>

      {!schedulerEnabled ? (
        <CoverageWarning severity="warning" title="The scheduler is not running">
          Jobs are registered but nothing is starting them. Collection only happens
          from the CLI or an external cron until the scheduler is enabled.
        </CoverageWarning>
      ) : null}

      {caveats.map((caveat) => (
        <CoverageWarning key={caveat} severity="info" title={caveat} />
      ))}

      {outcome ? <ActionOutcomePanel outcome={outcome} /> : null}

      {jobs.length === 0 ? (
        <EmptyState
          icon={Cog}
          title="No collection jobs registered"
          description="The engine reported no registered collectors. Nothing is being collected, which is different from a collector that is idle."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {jobs.map((job) => (
            <JobCard key={job.name} job={job} onOutcome={setOutcome} />
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className={cn("text-[10px] leading-relaxed text-muted-foreground")}>
          The research terminal is separate from order execution. No control on this
          page can place an order, reach a broker, change a risk limit or enable live
          trading.
        </p>
      </div>
    </div>
  );
}
