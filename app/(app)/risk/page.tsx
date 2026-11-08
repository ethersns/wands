import type { Metadata } from "next";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { EmergencyStop } from "@/components/shell/emergency-stop";
import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { RiskView } from "@/components/risk/risk-view";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOperator } from "@/lib/admin/guard";
import { getEngineStatus, getRisk } from "@/lib/api/endpoints";
import { formatDateTime, titleCase } from "@/lib/format";
import { severityTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Risk Centre",
};

export default async function RiskPage() {
  await requireOperator("/risk");

  const [risk, engine] = await Promise.all([getRisk(), getEngineStatus()]);
  const data = risk.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={risk.provenance} />
          </>
        }
        title="Risk Centre"
        description="Exposure limits, circuit breakers and the audit trail behind every risk decision."
        actions={<EmergencyStop />}
      />

      <DataNotice envelope={risk} />

      <SectionCard
        title="Active breaches"
        description="Constraints currently outside policy"
        bodyClassName="flex flex-col gap-2"
      >
        {data.breaches.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-profit/25 bg-profit/[0.06] px-2.5 py-2">
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-profit" aria-hidden />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No limits are breached. Every monitored constraint is within policy.
            </p>
          </div>
        ) : (
          data.breaches.map((breach) => {
            const tone = severityTone(breach.severity);
            return (
              <div
                key={breach.key}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2.5 py-2",
                  tone === "loss"
                    ? "border-loss/30 bg-loss/[0.07]"
                    : "border-primary/25 bg-primary/[0.06]",
                )}
              >
                <TriangleAlert
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    tone === "loss" ? "text-loss" : "text-primary",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-foreground">
                    {breach.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {breach.detail}
                  </p>
                </div>
                <StatusChip label={breach.severity} tone={tone} />
              </div>
            );
          })
        )}
      </SectionCard>

      <RiskView risk={data} />

      <SectionCard
        title="Risk audit log"
        description="Immutable record of risk events and policy changes"
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="hidden md:table-cell">Actor</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Ack</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.events.map((event) => {
              const tone = severityTone(event.severity);
              return (
                <TableRow key={event.id}>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.at)}
                  </TableCell>
                  <TableCell>
                    <StatusChip label={event.severity} tone={tone} />
                  </TableCell>
                  <TableCell className="hidden text-[11px] text-muted-foreground sm:table-cell">
                    {titleCase(event.category)}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <p className="text-[12px] font-medium text-foreground">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed whitespace-normal text-muted-foreground">
                      {event.detail}
                    </p>
                  </TableCell>
                  <TableCell className="hidden font-mono text-[11px] text-muted-foreground md:table-cell">
                    {event.actor}
                  </TableCell>
                  <TableCell className="hidden text-right lg:table-cell">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase",
                        event.acknowledged ? "text-muted-foreground" : "text-primary",
                      )}
                    >
                      {event.acknowledged ? "yes" : "pending"}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  );
}
