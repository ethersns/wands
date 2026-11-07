import Link from "next/link";

import type { InsiderTransaction, InsiderTransactionClass } from "@/lib/api/contracts";
import { TRANSACTION_CLASS_LABEL } from "@/lib/member/labels";
import { filingHref } from "@/lib/member/links";
import { Badge, formatDate, formatUsd } from "./ui";
import { SaveButton } from "./save-button";

function tone(classification: InsiderTransactionClass) {
  if (classification === "open_market_purchase") return "emerald" as const;
  if (classification === "open_market_sale") return "warn" as const;
  return "neutral" as const;
}

export function InsiderRow({ transaction }: { transaction: InsiderTransaction }) {
  const label = TRANSACTION_CLASS_LABEL[transaction.classification];

  return (
    <li className="flex flex-col gap-2 border-b border-mk-line px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/assets/${encodeURIComponent(transaction.symbol)}`}
            className="font-marketing-mono text-sm font-semibold text-mk-fg underline-offset-4 hover:text-mk-accent hover:underline"
          >
            {transaction.symbol}
          </Link>
          <Badge tone={tone(transaction.classification)}>{label}</Badge>
          {transaction.isAmendment ? <Badge>Amendment</Badge> : null}
          {transaction.dataQuality === "incomplete" ? <Badge tone="warn">Incomplete</Badge> : null}
        </div>
        <p className="mt-1 truncate text-sm text-mk-fg">{transaction.reportingPersonName}</p>
        <p className="truncate text-xs text-mk-muted">{transaction.role || transaction.issuerName}</p>
        <p className="mt-1 font-marketing-mono text-[11px] text-mk-dim">
          {transaction.shares === null ? "shares not reported" : `${transaction.shares.toLocaleString()} sh`}
          {" · "}
          {transaction.pricePerShare === null ? "price not reported" : `${formatUsd(transaction.pricePerShare)}/sh`}
          {" · "}
          {formatUsd(transaction.value)}
          {" · traded "}
          {formatDate(transaction.transactionDate)}
          {" · filed "}
          {formatDate(transaction.acceptedAt)}
        </p>
        <Link
          href={filingHref(transaction.id)}
          className="mt-1.5 inline-block text-xs text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline"
        >
          Open filing
        </Link>
      </div>
      <SaveButton
        kind="insider"
        refId={transaction.id}
        symbol={transaction.symbol}
        title={`${transaction.symbol} — ${label} by ${transaction.reportingPersonName}`}
        summary={`${transaction.shares ?? "?"} shares at ${transaction.pricePerShare ?? "unreported"} on ${formatDate(transaction.transactionDate)}`}
        payload={{ accessionNumber: transaction.accessionNumber, sourceUrl: transaction.sourceUrl }}
        className="shrink-0"
      />
    </li>
  );
}
