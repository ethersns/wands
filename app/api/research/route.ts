import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { authorizeOperatorRequest } from "@/lib/admin/guard";
import {
  getBacktests,
  getBots,
  getMarkets,
  getPortfolio,
  getRisk,
} from "@/lib/api/endpoints";
import { formatPercent, formatPrice } from "@/lib/format";

export const maxDuration = 30;

const MODEL = "anthropic/claude-sonnet-4.6";

const GUARDRAILS = `You are the research assistant inside Wands, a private automated trading terminal.

Hard limits — these are not negotiable:
- You never execute, place, amend or cancel an order. Execution happens only on the private trading engine, triggered by the operator.
- You never enable live trading, change risk limits, or alter bot configuration.
- You never ask for, repeat, or reveal API keys, tokens, secrets or account credentials.
- You never claim a trade, transfer or configuration change has happened.
- You never present a demonstration figure as a real account balance.

How to answer:
- You produce research and analysis only. Say so when a recommendation is a suggestion rather than an action.
- Be quantitative and specific. Cite the figures in the context below rather than inventing numbers.
- State uncertainty plainly. Never imply a strategy is guaranteed to profit.
- If asked to do something outside research, explain which control in the interface performs it and that the operator must do it.
- Keep answers tight: short paragraphs, occasional bullet lists, no filler.`;

function buildContext(input: {
  portfolio: Awaited<ReturnType<typeof getPortfolio>>;
  risk: Awaited<ReturnType<typeof getRisk>>;
  markets: Awaited<ReturnType<typeof getMarkets>>;
  bots: Awaited<ReturnType<typeof getBots>>;
  backtests: Awaited<ReturnType<typeof getBacktests>>;
}) {
  const { portfolio, risk, markets, bots, backtests } = input;
  const p = portfolio.data;
  const r = risk.data;

  const positions = p.positions
    .map(
      (position) =>
        `- ${position.symbol} (${position.marketType}): qty ${position.quantity}, value ${position.marketValue ?? "n/a"}, unrealised ${position.unrealisedPnl ?? "n/a"} (${formatPercent(position.unrealisedPnlPct, { signed: true })})`,
    )
    .join("\n");

  const quotes = markets.data.quotes
    .slice(0, 10)
    .map(
      (quote) =>
        `- ${quote.symbol}: ${formatPrice(quote.price)} (${formatPercent(quote.change24hPct, { signed: true })} 24h, vol ${formatPercent(quote.volatilityPct, { digits: 1 })}, ${quote.stale ? "STALE QUOTE" : "fresh"})`,
    )
    .join("\n");

  const botLines = bots.data
    .map(
      (bot) =>
        `- ${bot.name} [${bot.state}] ${bot.strategyName} on ${bot.symbols.join(", ")} (${bot.timeframe}), P&L ${bot.stats.pnl ?? "n/a"}, win rate ${formatPercent(bot.stats.winRatePct, { digits: 1 })}`,
    )
    .join("\n");

  const backtestLines = backtests.data
    .map(
      (backtest) =>
        `- ${backtest.strategyName} on ${backtest.symbols.join(", ")}: return ${formatPercent(backtest.metrics.totalReturnPct, { signed: true })} vs benchmark ${formatPercent(backtest.metrics.benchmarkReturnPct, { signed: true })}, max DD ${formatPercent(backtest.metrics.maxDrawdownPct, { digits: 1 })}, profit factor ${backtest.metrics.profitFactor}, walk-forward ${backtest.walkForward?.verdict ?? "not run"}`,
    )
    .join("\n");

  return `DATA PROVENANCE: ${portfolio.provenance === "live" ? "live from the trading engine" : "DEMONSTRATION FIXTURES — not a real account. Say so if you quote these figures."}

PORTFOLIO (${p.baseCurrency})
- Total equity: ${p.totalEquity}
- Cash: ${p.cash}, buying power: ${p.buyingPower}
- Day P&L: ${p.dayPnl} (${formatPercent(p.dayPnlPct, { signed: true })})
- Realised: ${p.realisedPnl}, unrealised: ${p.unrealisedPnl}, fees: ${p.feesPaid}
- Open positions: ${p.openPositions}
${positions}

RISK POLICY
- Max portfolio exposure: ${r.policy.maxPortfolioExposurePct}% (current ${r.utilisation.portfolioExposurePct}%)
- Max position exposure: ${r.policy.maxPositionExposurePct}% (largest ${r.utilisation.largestPositionPct}%)
- Per-trade risk budget: ${r.policy.perTradeRiskPct}%
- Daily loss limit: ${r.policy.dailyLossLimitPct}% (current ${r.utilisation.dailyLossPct}%)
- Max drawdown: ${r.policy.maxDrawdownPct}% (current ${r.utilisation.drawdownPct}%)
- Crypto cap: ${r.policy.cryptoAllocationCapPct}% (current ${r.utilisation.cryptoAllocationPct}%)
- Stocks cap: ${r.policy.stocksAllocationCapPct}% (current ${r.utilisation.stocksAllocationPct}%)
- Trading paused: ${r.policy.tradingPaused}, emergency stop: ${r.policy.emergencyStopEngaged}
- Open breaches: ${r.breaches.map((breach) => breach.label).join("; ") || "none"}

MARKET SNAPSHOT
${quotes}

BOTS
${botLines || "- none configured"}

BACKTESTS
${backtestLines || "- none"}`;
}

export async function POST(request: Request) {
  // The assistant is handed the operator's portfolio, risk policy, bot
  // configuration and backtests as context, so an unauthenticated call would
  // disclose all four. The guard runs before the body is even parsed.
  const auth = await authorizeOperatorRequest();
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.denial.code, message: auth.denial.message } },
      { status: auth.denial.status },
    );
  }

  const { messages }: { messages: UIMessage[] } = await request.json();

  const [portfolio, risk, markets, bots, backtests] = await Promise.all([
    getPortfolio(),
    getRisk(),
    getMarkets(),
    getBots(),
    getBacktests(),
  ]);

  const context = buildContext({ portfolio, risk, markets, bots, backtests });

  const result = streamText({
    model: MODEL,
    system: `${GUARDRAILS}\n\nCURRENT CONTEXT\n${context}`,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
