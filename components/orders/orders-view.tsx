"use client";

import * as React from "react";
import { ListOrdered } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Currency, Fill, Order, OrderStatus } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatNumber,
  formatPrice,
  formatRelative,
} from "@/lib/format";
import { orderStatus, reconciliationStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

const TABS: { value: string; label: string; statuses: OrderStatus[] | null }[] = [
  { value: "open", label: "Open", statuses: ["open", "partially_filled"] },
  { value: "filled", label: "Filled", statuses: ["filled"] },
  { value: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { value: "rejected", label: "Rejected", statuses: ["rejected"] },
  { value: "all", label: "All", statuses: null },
];

function OrdersTable({
  orders,
  currency,
}: {
  orders: Order[];
  currency: Currency;
}) {
  if (orders.length === 0) {
    return (
      <div className="px-4 pb-4 sm:px-5">
        <EmptyState
          icon={ListOrdered}
          title="No orders in this view"
          description="Orders appear here as soon as the engine submits them to a venue."
        />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Instrument</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="hidden sm:table-cell">Type</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="hidden text-right md:table-cell">Fees</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell">Recon</TableHead>
          <TableHead className="hidden xl:table-cell">Strategy</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const status = orderStatus(order.status);
          const recon = reconciliationStatus(order.reconciliation);
          return (
            <TableRow key={order.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-mono text-[12px] font-medium text-foreground">
                    {order.symbol}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {order.accountLabel}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "font-mono text-[11px] font-medium uppercase",
                    order.side === "buy" ? "text-profit" : "text-loss",
                  )}
                >
                  {order.side}
                </span>
              </TableCell>
              <TableCell className="hidden text-[11px] text-muted-foreground capitalize sm:table-cell">
                {order.type.replace("_", " ")}
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                {formatNumber(order.filledQuantity, { digits: 4 })}
                <span className="text-muted-foreground">
                  /{formatNumber(order.quantity, { digits: 4 })}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                {formatPrice(order.averageFillPrice ?? order.limitPrice)}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[12px] tabular text-muted-foreground md:table-cell">
                {formatCurrency(order.fees, currency)}
              </TableCell>
              <TableCell>
                <StatusChip label={status.label} tone={status.tone} />
                {order.rejectReason ? (
                  <p className="mt-1 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
                    {order.rejectReason}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <StatusChip label={recon.label} tone={recon.tone} />
              </TableCell>
              <TableCell className="hidden text-[11px] text-muted-foreground xl:table-cell">
                {order.strategyName ?? "Manual"}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[11px] text-muted-foreground sm:table-cell">
                {formatRelative(order.updatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function OrdersView({
  orders,
  fills,
  currency,
}: {
  orders: Order[];
  fills: Fill[];
  currency: Currency;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="open" className="gap-4">
        <TabsList className="w-full overflow-x-auto sm:w-fit">
          {TABS.map((tab) => {
            const count = tab.statuses
              ? orders.filter((order) => tab.statuses?.includes(order.status)).length
              : orders.length;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <SectionCard
              title={`${tab.label} orders`}
              description="Execution price, fees, venue confirmation and reconciliation state"
              bodyClassName="px-0 pb-0 sm:px-0"
            >
              <OrdersTable
                orders={
                  tab.statuses
                    ? orders.filter((order) => tab.statuses?.includes(order.status))
                    : orders
                }
                currency={currency}
              />
            </SectionCard>
          </TabsContent>
        ))}
      </Tabs>

      <SectionCard
        title="Fills"
        description="Individual executions, including partial fills"
        bodyClassName="px-0 pb-0 sm:px-0"
      >
        {fills.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState
              icon={ListOrdered}
              title="No fills recorded"
              description="Fills are written by the engine when a venue confirms an execution."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Instrument</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Order</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fills.map((fill) => (
                <TableRow key={fill.id}>
                  <TableCell className="font-mono text-[12px] text-foreground">
                    {fill.symbol}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-[11px] font-medium uppercase",
                        fill.side === "buy" ? "text-profit" : "text-loss",
                      )}
                    >
                      {fill.side}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                    {formatNumber(fill.quantity, { digits: 4 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular text-foreground">
                    {formatPrice(fill.price)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular text-muted-foreground">
                    {formatCurrency(fill.fees, currency)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] text-muted-foreground sm:table-cell">
                    {fill.orderId}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                    {formatRelative(fill.at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
