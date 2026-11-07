import type { Metadata } from "next";
import Link from "next/link";

import { SaveButton } from "@/components/member/save-button";
import { Badge, EmptyState, PageHeader, Panel, ProvenanceNote, formatDate, formatUsd } from "@/components/member/ui";
import { TRANSACTION_CLASS_LABEL } from "@/lib/member/labels";
import { assetHref } from "@/lib/member/links";
import { memberResearch } from "@/lib/member/research";
import { isSaved } from "@/lib/member/saved";
import { requireMember } from "@/lib/member/session";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Filing" };

export default async function FilingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireMember(`/app/insiders/${id}`);

  const envelope = await memberResearch.insiderTransaction(id);
  const transaction = envelope.data;

  if (!transaction) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Filing"
          title="This filing is not available"
          description="Filings are read from the engine by their identifier. The engine returned no record for this one, so nothing is shown rather than a reconstructed record."
        />
        <EmptyState
          title="Filing unavailable"
          description="The engine did not return this filing. It may have aged out of the published feed, or the engine may be unreachable right now."
          action={
            <Link
              href="/app/insiders"
              className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
            >
              Back to filings
            </Link>
          }
        />
        <ProvenanceNote
          provenance={envelope.provenance}
          generatedAt={envelope.generatedAt}
          warnings={envelope.warnings}
        />
      </div>
    );
  }

  const label = TRANSACTION_CLASS_LABEL[transaction.classification];
  const saved = await isSaved(session.user.id, "insider", transaction.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Form 4 filing"
        title={`${transaction.symbol} — ${label}`}
        description={`${transaction.reportingPersonName}${transaction.role ? ` · ${transaction.role}` : ""}`}
        actions={
          <SaveButton
            kind="insider"
            refId={transaction.id}
            symbol={transaction.symbol}
            title={`${transaction.symbol} — ${label} by ${transaction.reportingPersonName}`}
            summary={`${transaction.shares ?? "?"} shares at ${transaction.pricePerShare ?? "unreported"} on ${formatDate(transaction.transactionDate)}`}
            payload={{
              accessionNumber: transaction.accessionNumber,
              sourceUrl: transaction.sourceUrl,
              acceptedAt: transaction.acceptedAt,
            }}
            initialSaved={saved}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={assetHref(transaction.symbol)}
          className="font-marketing-mono text-sm font-semibold text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
        >
          {transaction.symbol} research
        </Link>
        <Badge tone={transaction.classification === "open_market_purchase" ? "emerald" : "neutral"}>{label}</Badge>
        {transaction.isAmendment ? <Badge>Amendment</Badge> : null}
        {transaction.dataQuality === "incomplete" ? <Badge tone="warn">Incomplete</Badge> : null}
      </div>

      <Panel title="Transaction">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Issuer</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{transaction.issuerName || "not reported"}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Security</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{transaction.securityTitle || "not reported"}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Shares</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {transaction.shares === null ? "not reported" : transaction.shares.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Price per share</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {transaction.pricePerShare === null ? "not reported" : formatUsd(transaction.pricePerShare)}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Value</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {transaction.value === null ? "not reported" : formatUsd(transaction.value)}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">
              Shares owned after
            </dt>
            <dd className="mt-0.5 text-sm text-mk-fg">
              {transaction.sharesOwnedAfter === null ? "not reported" : transaction.sharesOwnedAfter.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Traded</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{formatDate(transaction.transactionDate)}</dd>
          </div>
          <div>
            <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.16em] text-mk-dim">Became public</dt>
            <dd className="mt-0.5 text-sm text-mk-fg">{formatDate(transaction.acceptedAt)}</dd>
          </div>
        </dl>

        <p className="mt-4 border-t border-mk-line pt-3 text-xs leading-relaxed text-mk-muted text-pretty">
          The traded date is when the transaction happened. The public date is when the filing became knowable, and only
          that date may date a backtest.
        </p>
      </Panel>

      <Panel title="Source document">
        <div className="flex flex-col gap-2">
          <p className="font-marketing-mono text-xs text-mk-muted">
            Accession {transaction.accessionNumber || "not reported"}
          </p>
          {transaction.sourceUrl ? (
            <a
              href={transaction.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex w-fit items-center rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-accent/40 hover:text-mk-accent"
            >
              Open the filing on SEC EDGAR
            </a>
          ) : (
            <p className="text-sm leading-relaxed text-mk-muted text-pretty">
              The engine did not resolve a source link for this filing, so no claim is shown as sourced.
            </p>
          )}
        </div>
      </Panel>

      <ProvenanceNote
        provenance={envelope.provenance}
        generatedAt={envelope.generatedAt}
        warnings={envelope.warnings}
      />
    </div>
  );
}
