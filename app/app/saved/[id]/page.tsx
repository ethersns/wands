import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SavedNoteEditor } from "@/components/member/saved-note-editor";
import { Badge, PageHeader, Panel, formatDate } from "@/components/member/ui";
import { assetHref, filingHref, signalHref } from "@/lib/member/links";
import { getSavedItem, type SavedItem } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Saved research" };

const KIND_LABEL: Record<SavedItem["kind"], string> = {
  signal: "Signal",
  insider: "Filing",
  asset: "Asset",
  filing: "Filing",
};

const SNAPSHOT_LABEL: Record<string, string> = {
  accessionNumber: "Accession number",
  sourceUrl: "Source document",
  acceptedAt: "Became public",
  category: "Signal category",
  score: "Score",
  engineVersion: "Engine version",
  publicAvailableAt: "Became public",
  asOf: "Snapshot as of",
  compositeScore: "Composite ranking",
  coverageStatus: "Coverage status",
};

const DATE_KEYS = new Set(["acceptedAt", "publicAvailableAt", "asOf"]);

function liveHref(item: SavedItem): string | null {
  switch (item.kind) {
    case "asset":
      return item.symbol ? assetHref(item.symbol) : null;
    case "signal":
      return signalHref(item.refId);
    case "insider":
    case "filing":
      return filingHref(item.refId);
  }
}

function snapshotEntries(payload: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(payload).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
}

function SnapshotValue({ name, value }: { name: string; value: unknown }) {
  if (name === "sourceUrl" && typeof value === "string") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sm text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
      >
        Open the filing on SEC EDGAR
      </a>
    );
  }

  if (DATE_KEYS.has(name) && typeof value === "string") {
    return <>{formatDate(value)}</>;
  }

  return <>{String(value)}</>;
}

export default async function SavedDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireMember(`/app/saved/${id}`);

  const item = await getSavedItem(session.user.id, id);
  if (!item) notFound();

  const live = liveHref(item);
  const entries = snapshotEntries(item.payload);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Saved ${KIND_LABEL[item.kind].toLowerCase()}`}
        title={item.title}
        description={item.summary ?? `Saved on ${formatDate(item.createdAt)}.`}
        actions={
          live ? (
            <Link
              href={live}
              className="inline-flex items-center rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-accent/40 hover:text-mk-accent"
            >
              Open the live record
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge>{KIND_LABEL[item.kind]}</Badge>
        {item.symbol ? (
          <Link
            href={assetHref(item.symbol)}
            className="font-marketing-mono text-sm font-semibold text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
          >
            {item.symbol} research
          </Link>
        ) : null}
        <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          saved {formatDate(item.createdAt)}
        </span>
      </div>

      <Panel title="Your note">
        <SavedNoteEditor id={item.id} initialNote={item.note} />
      </Panel>

      <Panel title="Saved snapshot">
        {entries.length === 0 ? (
          <p className="text-sm leading-relaxed text-mk-muted text-pretty">
            This record was saved without a stored snapshot. Open the live record to read its current values.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {entries.map(([name, value]) => (
              <div key={name}>
                <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
                  {SNAPSHOT_LABEL[name] ?? name}
                </dt>
                <dd className="mt-0.5 text-sm text-mk-fg">
                  <SnapshotValue name={name} value={value} />
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="mt-4 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
          This is the record as it was when you saved it. It is not a live read and it does not change when the engine
          publishes new data. The live record is the only place to read current values.
        </p>
      </Panel>
    </div>
  );
}
