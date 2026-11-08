import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Kpi } from "@/components/admin/kpi";
import { MemberTabs } from "@/components/admin/member-tabs";
import { RangePicker } from "@/components/admin/range-picker";
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
import { requireOperator } from "@/lib/admin/guard";
import { resolveRange, timezoneLabel } from "@/lib/admin/period";
import {
  getSecuritySummary,
  listSecurityEvents,
  listSignIns,
  securityEventLabel,
} from "@/lib/admin/security";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Security activity",
};

export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireOperator("/dashboard/members/security");

  const params = await searchParams;
  const range = resolveRange(params);

  const [summary, signIns, events] = await Promise.all([
    getSecuritySummary(range),
    listSignIns(range, 50),
    listSecurityEvents(range, 50),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {range.label} · {timezoneLabel()}
          </span>
        }
        title="Security activity"
        description="Sign-ins, failed attempts and account status changes. IP addresses come from headers the hosting edge writes, never from a client-supplied forwarded header."
      />

      <MemberTabs />

      <RangePicker range={range} basePath="/dashboard/members/security" />

      <section aria-label="Security totals" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Sign-ins"
          value={formatNumber(summary.signIns)}
          footnote={`${formatNumber(summary.distinctAccounts)} distinct accounts`}
        />
        <Kpi
          label="Failed attempts"
          value={formatNumber(summary.failedSignIns)}
          footnote={summary.failedSignIns > 0 ? "review below" : "none recorded"}
        />
        <Kpi
          label="Suspensions"
          value={formatNumber(summary.suspensions)}
          footnote={`${formatNumber(summary.deletions)} deletions`}
        />
        <Kpi
          label="With IP recorded"
          value={formatNumber(summary.withIp)}
          footnote={`${formatNumber(summary.withoutIp)} without`}
        />
      </section>

      <SectionCard
        title="Sign-in history"
        description="Successful sign-ins, newest first. Rows written before IP capture began show no address."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {signIns.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ShieldCheck}
              title="No sign-ins in this window"
              description="Sign-in history begins with the next successful sign-in."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>IP address</TableHead>
                  <TableHead>User agent</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signIns.map((row, index) => (
                  <TableRow key={`${row.occurred_at}-${index}`}>
                    <TableCell>
                      {row.user_id ? (
                        <Link
                          href={`/dashboard/members/${row.user_id}`}
                          className="font-mono text-[11px] text-foreground hover:underline"
                        >
                          {row.email ?? row.user_id}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Deleted account
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-foreground">
                      {row.ip_address ?? (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-[11px] text-muted-foreground">
                      {row.user_agent ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.occurred_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Security events"
        description="Failed sign-ins, session revocations and account status changes."
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {events.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ShieldCheck}
              title="No security events"
              description="Nothing has been recorded in this window."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>IP address</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((row, index) => (
                  <TableRow key={`${row.occurred_at}-${index}`}>
                    <TableCell className="text-[11px] whitespace-nowrap text-foreground">
                      {securityEventLabel(row.kind)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.outcome === "failure"
                            ? "text-[11px] text-destructive"
                            : "text-[11px] text-muted-foreground"
                        }
                      >
                        {row.outcome}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.user_id ? (
                        <Link
                          href={`/dashboard/members/${row.user_id}`}
                          className="font-mono text-[11px] text-foreground hover:underline"
                        >
                          {row.email ?? row.user_id}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {row.email ?? "Unresolved"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-foreground">
                      {row.ip_address ?? (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.occurred_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        IP addresses are personal data. They are recorded only from trusted infrastructure
        metadata, retained for 180 days, and never used to infer a location. Deleting a member
        severs the link between these rows and the person while keeping the aggregate counts
        honest.
      </p>
    </div>
  );
}
