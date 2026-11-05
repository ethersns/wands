import { CircleAlert } from "lucide-react";

import { ModeBadge } from "@/components/shared/mode-badge";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrokerAccount, Currency } from "@/lib/api/contracts";
import { formatCurrency, formatRelative, titleCase } from "@/lib/format";
import { connectionStatus } from "@/lib/status";

export function AccountsTable({
  accounts,
  currency,
}: {
  accounts: BrokerAccount[];
  currency: Currency;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Account</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Access</TableHead>
          <TableHead className="text-right">Equity</TableHead>
          <TableHead className="hidden text-right md:table-cell">Cash</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Last sync</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => {
          const status = connectionStatus(account.status);
          return (
            <TableRow key={account.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium text-foreground">
                    {account.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {titleCase(account.provider)} · {titleCase(account.marketType)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <StatusChip label={status.label} tone={status.tone} />
                  <ModeBadge mode={account.mode} />
                </div>
                {account.error ? (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <CircleAlert className="size-2.5 shrink-0" aria-hidden />
                    {account.error}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {account.access === "trading" ? "Trading" : "Read only"}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                {formatCurrency(account.equity, currency)}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[12px] tabular text-muted-foreground md:table-cell">
                {formatCurrency(account.cash, currency)}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[11px] text-muted-foreground lg:table-cell">
                {formatRelative(account.lastSyncedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
