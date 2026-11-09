import type { Metadata } from "next";

import { InstitutionRow } from "@/components/member/institution-row";
import { Pagination } from "@/components/member/pagination";
import { EmptyState, PageHeader, Panel, ProvenanceNote } from "@/components/member/ui";
import { memberResearch } from "@/lib/member/research";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Institutional discovery" };

type SearchParams = { page?: string };

export default async function InstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireMember("/app/institutions");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const feed = await memberResearch.institutions(page, 25);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Research"
        title="Institutional discovery"
        description="Form 13F holdings as they became public. A quarter's positions are knowable from the filing date, not from the quarter they describe."
      />

      <Panel title={`${feed.data.total.toLocaleString()} institutions`} bodyClassName="p-0">
        {feed.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No institutional filings stored"
              description="An empty result means no 13F filing has been collected yet. It does not mean no institution holds a position."
            />
          </div>
        ) : (
          <>
            <ul>
              {feed.data.items.map((institution) => (
                <InstitutionRow key={institution.cik} institution={institution} />
              ))}
            </ul>
            <Pagination
              page={page}
              hasMore={feed.data.hasMore}
              basePath="/app/institutions"
              params={{}}
            />
          </>
        )}
      </Panel>

      <ProvenanceNote
        provenance={feed.provenance}
        generatedAt={feed.generatedAt}
        warnings={feed.warnings}
        unreachable={feed.unreachable}
      />
    </div>
  );
}
