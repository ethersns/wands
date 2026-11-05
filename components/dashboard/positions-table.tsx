import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { StatusChip } from "@/components/shared/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Currency, Position } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSignedCurrency,
  toneClass,
  toneOf,
} from "@/lib/format";
import { dataQuality, positionSource } from "@/lib/status";
import { cn } from "@/lib/utils";

export function PositionsTable({
  positions,
  currency,
  limit,
}: {
  positions: Position[];
  currency: Currency;
  limit?: number;
}) {
  const rows = limit ? positions.slice(0, limit) : positions;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Instrument</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Avg entry</TableHead>
          <TableHead className="text-right">Last</TableHead>
          <TableHead className="hidden text-right md:table-cell">Value</TableHead>
          <TableHead className="text-right">Unrealised</TableHead>
          <TableHead className="hidden md:table-cell">Source</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Bot</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((position) => {
          const tone = toneOf(position.unrealisedPnl);
          const source = positionSource(position.source);
          const quality = dataQuality(position.priceQuality);
          return (
            <TableRow key={position.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-medium text-foreground">
                    {position.symbol}
                  </span>
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    {position.name}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] tabular text-muted-foreground">
                {formatNumber(position.quantity, { digits: 4 })}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[12px] tabular text-muted-foreground sm:table-cell">
                {formatPrice(position.averageEntryPrice)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[12px] tabular text-foreground">
                    {formatPrice(position.lastPrice)}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
                    {position.priceStale ? "stale" : quality.label}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[12px] tabular text-foreground md:table-cell">
                {formatCurrency(position.marketValue, currency)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end">
                  <span
                    className={cn(
                      "font-mono text-[12px] tabular",
                      toneClass(tone),
                    )}
                  >
                    {formatSignedCurrency(position.unrealisedPnl, currency)}
                  </span>
                  <span className={cn("font-mono text-[10px] tabular", toneClass(tone))}>
                    {formatPercent(position.unrealisedPnlPct, { signed: true })}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <StatusChip label={source.label} tone={source.tone} />
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                {position.botId ? (
                  <Link
                    href="/bots"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {position.botId.replace("bot-", "")}
                    <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-[11px] text-muted-foreground/60">Manual</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
