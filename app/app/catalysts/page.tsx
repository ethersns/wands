import type { Metadata } from "next";

import { CatalystFilters } from "@/components/member/catalyst-filters";
import { CatalystSources } from "@/components/member/catalyst-sources";
import { CatalystTimeline } from "@/components/member/catalyst-timeline";
import { PageHeader, Panel, ProvenanceNote, StatTile, formatDate } from "@/components/member/ui";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Catalyst Radar" };

const WINDOWS = new Set(["30", "90", "180", "365"]);

type SearchParams = Promise<{ category?: string; symbol?: string; window?: string }>;

export default async function CatalystsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireMember("/app/catalysts");
  const params = await searchParams;

  const category = typeof params.category === "string" ? params.category : "";
  const symbol = typeof params.symbol === "string" ? params.symbol.trim().toUpperCase() : "";
  const windowValue = params.window && WINDOWS.has(params.window) ? params.window : "90";

  const envelope = await memberResearch.catalysts({
    category: category || undefined,
    symbol: symbol || undefined,
    windowDays: Number(windowValue),
  });

  const feed = envelope.data;
  // The engine orders upcoming before recent and reports how many of each it
  // returned, so the split is read from the payload rather than recomputed here
  // against a clock the server and the engine might disagree about.
  const upcoming = feed.items.slice(0, feed.upcoming);
  const recent = feed.items.slice(feed.upcoming);
  const sourcesRead = feed.sources.filter((source) => source.status === "ok").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Catalyst Radar"
        description="Scheduled and recently published market events, each traced to the source that published it. A catalyst is context for a research decision: it says what is coming and how reliable the date is, never which way a price will move."
      />

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={envelope.warnings}
        unreachable={envelope.unreachable}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Upcoming" value={feed.upcoming} hint="scheduled ahead" />
        <StatTile label="Recently published" value={feed.recent} hint="already happened" />
        <StatTile
          label="Sources read"
          value={`${sourcesRead}/${feed.sources.length}`}
          hint="scheduled-event sources"
        />
        <StatTile
          label="Window"
          value={`${formatDate(feed.windowStart)} to ${formatDate(feed.windowEnd)}`}
          valueClassName="text-sm"
        />
      </div>

      <CatalystFilters category={category} symbol={symbol} windowValue={windowValue} />

      <Panel title="Upcoming">
        <CatalystTimeline
          items={upcoming}
          emptyTitle="No scheduled events in this window"
          emptyDescription="Nothing scheduled falls inside the selected window. Widen the window, or check the source status below to see whether a source could be read at all."
        />
      </Panel>

      <Panel title="Recently published">
        <CatalystTimeline
          items={recent}
          emptyTitle="No recently published events"
          emptyDescription="No disclosure has been collected for this window. That is a collection state, not evidence that nothing happened."
        />
      </Panel>

      <Panel title="Scheduled-event sources">
        <CatalystSources sources={feed.sources} />
      </Panel>

      <Panel title="Coverage and limitations">
        <ul className="flex flex-col gap-2">
          {feed.coverageLimitations.map((limitation) => (
            <li
              key={limitation}
              className="text-xs leading-relaxed text-mk-muted text-pretty"
            >
              {limitation}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
