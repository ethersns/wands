"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, UserSearch } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { DataQualityBadge } from "./data-quality-badge";
import { DirectionBadge } from "./signal-badge";
import { FilingSourceLink } from "./filing-link";
import { KeyValueList } from "./evidence-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InsiderTransaction } from "@/lib/api/contracts";
import { formatCurrency, formatDateTime, formatNumber, formatPrice } from "@/lib/format";
import {
  insiderClassLabel,
  insiderClassTone,
  insiderDirection,
  isOpenMarketClass,
  sortRows,
  type SortDirection,
} from "@/lib/intelligence/presentation";
import { toneText } from "@/lib/status";
import { cn } from "@/lib/utils";

type SortKey = "acceptedAt" | "value" | "transactionDate" | "symbol";

function sortValue(row: InsiderTransaction, key: SortKey): number | string | null {
  switch (key) {
    case "acceptedAt":
      return row.acceptedAt;
    case "transactionDate":
      return row.transactionDate;
    case "value":
      return row.value;
    case "symbol":
      return row.symbol;
  }
}

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-[10px] font-medium tracking-[0.06em] uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className="size-2.5" aria-hidden />
      </button>
    </TableHead>
  );
}

/**
 * Reported insider transactions.
 *
 * The classification column is the point of this table: an award, a gift and a
 * tax withholding all move shares, and none of them is a decision to buy or
 * sell in the market. Only open-market lines carry a direction.
 */
export function InsiderTable({
  transactions,
  emptyTitle,
  emptyDescription,
}: {
  transactions: InsiderTransaction[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [sort, setSort] = React.useState<{ key: SortKey; direction: SortDirection }>({
    key: "acceptedAt",
    direction: "desc",
  });
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const rows = React.useMemo(
    () => sortRows(transactions, (row) => sortValue(row, sort.key), sort.direction),
    [transactions, sort],
  );

  function onSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "symbol" ? "asc" : "desc" },
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="px-4 py-4 sm:px-5">
        <EmptyState
          icon={UserSearch}
          title={emptyTitle ?? "No insider transactions stored"}
          description={
            emptyDescription ??
            "Nothing is stored for these filters. That is not the same as no insider activity occurring — it means the collector has not stored a matching filing."
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader
              label="Issuer"
              sortKey="symbol"
              active={sort.key === "symbol"}
              direction={sort.direction}
              onSort={onSort}
            />
            <TableHead>Reporting person</TableHead>
            <TableHead>Class</TableHead>
            <TableHead className="hidden text-right md:table-cell">Shares</TableHead>
            <TableHead className="hidden text-right 2xl:table-cell">Price</TableHead>
            <SortHeader
              label="Value"
              sortKey="value"
              active={sort.key === "value"}
              direction={sort.direction}
              onSort={onSort}
              className="text-right"
            />
            <SortHeader
              label="Traded"
              sortKey="transactionDate"
              active={sort.key === "transactionDate"}
              direction={sort.direction}
              onSort={onSort}
              className="hidden 2xl:table-cell"
            />
            <SortHeader
              label="Public"
              sortKey="acceptedAt"
              active={sort.key === "acceptedAt"}
              direction={sort.direction}
              onSort={onSort}
              className="hidden text-right lg:table-cell"
            />
            <TableHead className="text-right">
              <span className="sr-only">Evidence</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isOpen = expanded === row.id;
            const direction = insiderDirection(row.classification);
            const openMarket = isOpenMarketClass(row.classification);

            return (
              <React.Fragment key={row.id}>
                <TableRow className={cn(isOpen && "bg-accent/40")}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-mono text-[12px] font-medium text-foreground">
                        {row.symbol || "—"}
                      </span>
                      <span className="max-w-40 truncate text-[10px] text-muted-foreground">
                        {row.issuerName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="max-w-44 truncate text-[11px] text-foreground">
                        {row.reportingPersonName}
                      </span>
                      <span className="max-w-44 truncate text-[10px] text-muted-foreground">
                        {row.role || "Role not reported"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={cn(
                          "text-[11px]",
                          openMarket ? toneText[insiderClassTone(row.classification)] : "text-muted-foreground",
                        )}
                      >
                        {insiderClassLabel(row.classification)}
                      </span>
                      <DirectionBadge direction={direction} />
                      {row.isAmendment ? (
                        <span className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
                          Amended
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] tabular text-foreground md:table-cell">
                    {formatNumber(row.shares, { digits: 0 })}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground 2xl:table-cell">
                    {row.pricePerShare === null ? "not reported" : formatPrice(row.pricePerShare)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular text-foreground">
                    {row.value === null ? (
                      <span
                        className="text-muted-foreground"
                        title="The filing reported no price, so no value can be computed. This is not zero."
                      >
                        —
                      </span>
                    ) : (
                      formatCurrency(row.value, "USD", { compact: true })
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-[11px] tabular text-muted-foreground 2xl:table-cell">
                    {formatDateTime(row.transactionDate)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground lg:table-cell">
                    {formatDateTime(row.acceptedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {isOpen ? "Hide" : "Evidence"}
                      <span className="sr-only">
                        {" "}
                        for {row.reportingPersonName} at {row.symbol}
                      </span>
                    </button>
                  </TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="bg-surface/40 p-3">
                      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="max-w-2xl text-[11px] leading-relaxed text-pretty text-foreground/85">
                            {row.description || "The filing supplied no description."}
                          </p>
                          <div className="flex items-center gap-2">
                            <DataQualityBadge quality={row.dataQuality} />
                            <FilingSourceLink href={row.sourceUrl} />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <KeyValueList
                            items={[
                              { label: "Accession", value: row.accessionNumber },
                              { label: "Transaction code", value: row.transactionCode },
                              { label: "Security", value: row.securityTitle || "—" },
                              { label: "Ownership", value: row.directOrIndirect || "—" },
                              {
                                label: "Shares after",
                                value: formatNumber(row.sharesOwnedAfter, { digits: 0 }),
                              },
                              { label: "Person CIK", value: row.reportingPersonCik },
                            ]}
                          />
                          <KeyValueList
                            items={[
                              {
                                label: "Traded",
                                value: formatDateTime(row.transactionDate),
                              },
                              {
                                label: "Became public",
                                value: formatDateTime(row.acceptedAt),
                              },
                              {
                                label: "Open market",
                                value: openMarket ? "yes" : "no",
                              },
                              {
                                label: "Amendment",
                                value: row.isAmendment ? "yes" : "no",
                              },
                            ]}
                          />
                        </div>
                        <p className="text-[10px] leading-relaxed text-muted-foreground">
                          &ldquo;Traded&rdquo; is when the transaction happened.
                          &ldquo;Became public&rdquo; is the SEC acceptance time, and
                          only that instant may date a backtest.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
