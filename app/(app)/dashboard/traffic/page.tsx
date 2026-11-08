import type { Metadata } from "next";
import { BarChart3, Globe, Megaphone, MousePointerClick } from "lucide-react";

import { Kpi } from "@/components/admin/kpi";
import { RangePicker } from "@/components/admin/range-picker";
import { TrendChart } from "@/components/admin/trend-chart";
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
import { getTraffic } from "@/lib/admin/traffic";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Traffic and analytics",
};

export const dynamic = "force-dynamic";

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireOperator("/dashboard/traffic");

  const params = await searchParams;
  const range = resolveRange(params);
  const traffic = await getTraffic(range);

  const notTracked = !traffic.tracked;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {range.label} · {timezoneLabel()}
          </span>
        }
        title="Traffic and analytics"
        description="First-party measurement of the public site. No third-party script, no cookies, no stored IP addresses."
      />

      <RangePicker range={range} basePath="/dashboard/traffic" />

      <section aria-label="Traffic totals" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Page views"
          value={formatNumber(traffic.views)}
          tracked={!notTracked}
          footnote={traffic.since ? `tracking since ${traffic.since}` : undefined}
        />
        <Kpi
          label="Unique visitors"
          value={formatNumber(traffic.visitors)}
          tracked={!notTracked}
          footnote={notTracked ? undefined : "daily-rotating digest"}
        />
        <Kpi
          label="Views per visitor"
          value={
            traffic.visitors > 0 ? (traffic.views / traffic.visitors).toFixed(1) : "—"
          }
          tracked={!notTracked}
        />
        <Kpi
          label="Tracking began"
          value={traffic.since ?? "—"}
          tracked={!notTracked}
          footnote={notTracked ? undefined : "no earlier history exists"}
        />
      </section>

      {notTracked ? (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12px] leading-relaxed text-foreground"
        >
          Traffic collection has not recorded a page view yet. Wands had no analytics
          provider enabled, so this table starts empty and fills from the next visit to a
          public page. No historical traffic is inferred or backfilled.
        </div>
      ) : null}

      <SectionCard
        title="Page views per day"
        description="Operator traffic is recorded but excluded from every figure on this page."
      >
        <TrendChart
          data={traffic.series}
          label="Page views"
          emptyLabel={
            notTracked
              ? "Not yet tracked — collection begins with the next public page view."
              : "No page views in this window."
          }
        />
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title="Most visited pages" description="Public pages only.">
          {traffic.topPages.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={notTracked ? "Not yet tracked" : "No page views in range"}
              description={
                notTracked
                  ? "Collection begins with the next public page view."
                  : "No public page was viewed in this window."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traffic.topPages.map((page) => (
                  <TableRow key={page.path}>
                    <TableCell className="font-mono text-[11px] text-foreground">
                      {page.path}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                      {page.views}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                      {page.visitors}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Landing pages"
          description="Where visitors arrived from outside the site."
        >
          {traffic.landingPages.length === 0 ? (
            <EmptyState
              icon={MousePointerClick}
              title={notTracked ? "Not yet tracked" : "No external arrivals"}
              description={
                notTracked
                  ? "Collection begins with the next public page view."
                  : "Every recorded view in this window came from within the site."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Arrivals</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traffic.landingPages.map((page) => (
                  <TableRow key={page.path}>
                    <TableCell className="font-mono text-[11px] text-foreground">
                      {page.path}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                      {page.views}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-muted-foreground">
                      {page.visitors}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title="Traffic sources" description="Referrer category per page view.">
          {traffic.referrers.length === 0 ? (
            <EmptyState
              icon={Globe}
              title={notTracked ? "Not yet tracked" : "No referrers in range"}
              description={
                notTracked
                  ? "Collection begins with the next public page view."
                  : "No page views were recorded in this window."
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {traffic.referrers.map((row) => (
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

        <SectionCard
          title="Campaigns"
          description="UTM source, medium and campaign captured on the landing URL."
        >
          {traffic.campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No tagged campaigns"
              description="No page view in this window carried UTM parameters."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Medium</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traffic.campaigns.map((row) => (
                  <TableRow key={`${row.source}-${row.medium}-${row.campaign}`}>
                    <TableCell className="text-[11px] text-foreground">{row.source}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{row.medium}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.campaign}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                      {row.views}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <SectionCard title="How this is measured" description="The privacy model, stated plainly.">
        <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            A visitor is identified by a digest of their address and user agent, keyed with a
            salt that is regenerated every day. The same person produces a different digest
            tomorrow, so cross-day tracking is impossible by construction.
          </li>
          <li>
            No IP address, user agent, cookie or fingerprint is stored. Only the digest, the
            path, the referrer host and any UTM tags are kept.
          </li>
          <li>
            Signed-in surfaces are never recorded, so member behaviour does not enter this
            table. Operator views are recorded but excluded from every figure shown here.
          </li>
          <li>
            Rows older than 400 days are pruned automatically. There is no third-party
            analytics script on the site.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
