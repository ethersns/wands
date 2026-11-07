import type { Metadata } from "next";
import Link from "next/link";

import { SaveButton } from "@/components/member/save-button";
import { Badge, EmptyState, PageHeader, Panel, ProvenanceNote, formatDate } from "@/components/member/ui";
import { SIGNAL_LABEL } from "@/lib/member/labels";
import { assetHref } from "@/lib/member/links";
import { memberResearch } from "@/lib/member/research";
import { isSaved } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Signal" };

export default async function SignalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireMember(`/app/signals/${id}`);

  const envelope = await memberResearch.signal(id);
  const signal = envelope.data;

  if (!signal) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Signal"
          title="This signal is not available"
          description="Signals are read from the engine by their identifier. The engine returned no record for this one, so nothing is shown rather than a reconstructed record."
        />
        <EmptyState
          title="Signal unavailable"
          description="The engine did not return this signal. It may have been superseded, or the engine may be unreachable right now."
          action={
            <Link
              href="/app/signals"
              className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
            >
              Back to signals
            </Link>
          }
        />
        <ProvenanceNote
          provenance={envelope.provenance}
          generatedAt={envelope.generatedAt}
          warnings={envelope.warnings}
          unreachable={envelope.unreachable}
        />
      </div>
    );
  }

  const [sources, saved] = await Promise.all([
    memberResearch.sources({ type: "signal", id: signal.id, symbol: signal.symbol }),
    isSaved(session.user.id, "signal", signal.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Signal"
        title={`${signal.symbol} — ${SIGNAL_LABEL[signal.category]}`}
        description={signal.explanation}
        actions={
          <SaveButton
            kind="signal"
            refId={signal.id}
            symbol={signal.symbol}
            title={`${signal.symbol} — ${SIGNAL_LABEL[signal.category]}`}
            summary={signal.explanation}
            payload={{
              category: signal.category,
              score: signal.score,
              engineVersion: signal.engineVersion,
              publicAvailableAt: signal.publicAvailableAt,
            }}
            initialSaved={saved}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={assetHref(signal.symbol)}
          className="font-marketing-mono text-sm font-semibold text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
        >
          {signal.symbol} research
        </Link>
        <Badge tone="accent">{SIGNAL_LABEL[signal.category]}</Badge>
        {signal.dataQuality === "incomplete" || signal.dataQuality === "unavailable" ? (
          <Badge tone="warn">{signal.dataQuality}</Badge>
        ) : null}
      </div>

      <Panel title="Measurement">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Score</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {signal.score === null ? "No score published" : `${signal.score}/100`}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Raw measurement</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {signal.rawMeasurement.toLocaleString()} {signal.rawUnit}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
              Activity happened
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{formatDate(signal.eventTime)}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
              Became public
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{formatDate(signal.publicAvailableAt)}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Calculated</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{formatDate(signal.calculatedAt)}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Engine</dt>
            <dd className="mt-0.5 font-marketing-mono text-sm text-mk-fg">{signal.engineVersion || "not reported"}</dd>
          </div>
        </dl>

        <p className="mt-4 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
          A research score is a bounded 0-100 ranking of evidence. It is not a probability, an expected return, or a
          recommendation. Only the public-available date may date a backtest.
        </p>

        {signal.confidenceNotes ? (
          <p className="mt-2 text-xs leading-relaxed text-mk-muted text-pretty">{signal.confidenceNotes}</p>
        ) : null}
      </Panel>

      <Panel title="Evidence" bodyClassName="p-0">
        {sources.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No source documents resolved"
              description="Every claim is meant to carry a source link. None could be resolved for this signal, so no claim is shown as sourced."
            />
          </div>
        ) : (
          <ul className="divide-y divide-mk-line">
            {sources.data.map((source) => (
              <li key={source.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
                  >
                    {source.label}
                  </a>
                  {source.formType ? <Badge>{source.formType}</Badge> : null}
                  <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    public {formatDate(source.publicAvailableAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-mk-muted text-pretty">{source.supports}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={envelope.warnings}
        unreachable={envelope.unreachable}
      />
    </div>
  );
}
