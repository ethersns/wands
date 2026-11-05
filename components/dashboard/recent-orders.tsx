import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/lib/api/contracts";
import { formatNumber, formatPrice, formatRelative } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export function RecentOrders({
  orders,
  limit = 5,
}: {
  orders: Order[];
  limit?: number;
}) {
  const rows = orders.slice(0, limit);

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((order) => {
        const status = orderStatus(order.status);
        return (
          <li
            key={order.id}
            className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded border font-mono text-[9px] font-semibold uppercase",
                order.side === "buy"
                  ? "border-profit/30 bg-profit/10 text-profit"
                  : "border-loss/30 bg-loss/10 text-loss",
              )}
              aria-label={order.side}
            >
              {order.side === "buy" ? "B" : "S"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[12px] font-medium text-foreground">
                  {order.symbol}
                </span>
                <StatusChip label={status.label} tone={status.tone} />
              </div>
              <p className="truncate text-[10px] text-muted-foreground">
                {formatNumber(order.filledQuantity || order.quantity, { digits: 4 })} @{" "}
                {formatPrice(order.averageFillPrice ?? order.limitPrice)} ·{" "}
                {order.type.replace("_", " ")}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[10px] text-muted-foreground">
                {formatRelative(order.updatedAt)}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground/60">
                {order.accountLabel}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
