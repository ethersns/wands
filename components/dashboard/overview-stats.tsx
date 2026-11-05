import { Stat } from "@/components/shared/stat";
import type { PortfolioSummary } from "@/lib/api/contracts";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  toneOf,
} from "@/lib/format";

export function OverviewStats({ portfolio }: { portfolio: PortfolioSummary }) {
  const currency = portfolio.baseCurrency;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border xl:grid-cols-4">
      <div className="bg-card p-4">
        <Stat
          label="Total equity"
          value={formatCurrency(portfolio.totalEquity, currency)}
          delta={portfolio.dayPnlPct}
          deltaLabel="today"
          emphasis
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Available cash"
          value={formatCurrency(portfolio.cash, currency)}
          footnote={`Buying power ${formatCurrency(portfolio.buyingPower, currency, { compact: true })}`}
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Today's P&L"
          value={formatSignedCurrency(portfolio.dayPnl, currency)}
          tone={toneOf(portfolio.dayPnl)}
          footnote={formatPercent(portfolio.dayPnlPct, { signed: true })}
        />
      </div>
      <div className="bg-card p-4">
        <Stat
          label="Unrealised P&L"
          value={formatSignedCurrency(portfolio.unrealisedPnl, currency)}
          tone={toneOf(portfolio.unrealisedPnl)}
          footnote={`Realised ${formatSignedCurrency(portfolio.realisedPnl, currency, { compact: true })}`}
        />
      </div>
    </div>
  );
}
