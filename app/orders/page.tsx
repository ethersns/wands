import type { Metadata } from "next";

import { OrdersView } from "@/components/orders/orders-view";
import { DataNotice } from "@/components/shared/data-notice";
import { ModeBadge } from "@/components/shared/mode-badge";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceBadge } from "@/components/shared/provenance-badge";
import { Stat } from "@/components/shared/stat";
import {
  getEngineStatus,
  getFills,
  getOrders,
  getPortfolio,
} from "@/lib/api/endpoints";
import { formatCurrency, formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Trades & Orders",
};

export default async function OrdersPage() {
  const [orders, fills, portfolio, engine] = await Promise.all([
    getOrders(),
    getFills(),
    getPortfolio(),
    getEngineStatus(),
  ]);

  const currency = portfolio.data.baseCurrency;
  const open = orders.data.filter(
    (order) => order.status === "open" || order.status === "partially_filled",
  ).length;
  const filled = orders.data.filter((order) => order.status === "filled").length;
  const rejected = orders.data.filter((order) => order.status === "rejected").length;
  const unreconciled = orders.data.filter(
    (order) => order.reconciliation !== "matched",
  ).length;
  const notional = orders.data.reduce(
    (sum, order) =>
      sum + (order.averageFillPrice ?? 0) * (order.filledQuantity ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <>
            <ModeBadge mode={engine.data.mode} />
            <ProvenanceBadge provenance={orders.provenance} />
          </>
        }
        title="Trades & orders"
        description="Every order the engine has submitted, with venue confirmation and reconciliation state."
      />

      <DataNotice envelope={orders} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        <div className="bg-card p-4">
          <Stat label="Working" value={String(open)} footnote="open or partial" />
        </div>
        <div className="bg-card p-4">
          <Stat label="Filled" value={String(filled)} footnote="fully executed" />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Filled notional"
            value={formatCurrency(notional, currency, { compact: true })}
            footnote={`${formatNumber(fills.data.length, { digits: 0 })} fills`}
          />
        </div>
        <div className="bg-card p-4">
          <Stat
            label="Needs attention"
            value={String(rejected + unreconciled)}
            footnote={`${rejected} rejected · ${unreconciled} unreconciled`}
            tone={rejected + unreconciled > 0 ? "loss" : "neutral"}
          />
        </div>
      </div>

      <OrdersView orders={orders.data} fills={fills.data} currency={currency} />
    </div>
  );
}
