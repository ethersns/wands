import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert, TriangleAlert } from "lucide-react";

import { MoneyDesk } from "@/components/money/money-desk";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Stat } from "@/components/shared/stat";
import { getMarketHealth, getMarketQuote } from "@/lib/api/markets";
import { getOpportunityBudget, getOpportunityCandidates } from "@/lib/api/opportunity";
import { requireFounder } from "@/lib/auth/founder";
import { parseDecimal } from "@/lib/money/calc";
import { listTrades } from "@/lib/money/journal";
import type { MoneyTrade, QuoteView } from "@/lib/money/types";
import {
  buildClosedTradeView,
  buildOpenPositionView,
  buildSummary,
  quoteView,
} from "@/lib/money/view";

export const metadata: Metadata = {
  title: "Money",
  description:
    "A manual trade journal: the setups the engine found, the fills you reported, and the P&L those two prices imply.",
};

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  // Every read below carries the privileged engine credential, and the journal
  // is scoped to one account. The grant is checked before the first fetch so an
  // unauthorised member never causes one.
  const access = await requireFounder();

  if (!access.ok) {
    if (access.reason === "unauthenticated") {
      redirect(`/signin?next=${encodeURIComponent("/app/money")}`);
    }

    // A member without the grant is told nothing about what lives here.
    notFound();
  }

  // The journal table is created by `db:setup`. Until that has run, the read
  // fails with a missing-relation error. Reporting that plainly is better than
  // a 500: the founder needs to know the schema is behind, not that the page is
  // broken, and the rest of the page can still show what the engine returned.
  let trades: MoneyTrade[] = [];
  let journalError: string | null = null;

  const [budgetResult, candidatesResult, healthResult] = await Promise.all([
    getOpportunityBudget(),
    getOpportunityCandidates(),
    getMarketHealth(),
  ]);

  try {
    trades = await listTrades(access.userId);
  } catch (cause) {
    journalError =
      cause instanceof Error ? cause.message : "The trade journal could not be read.";
  }

  const openTrades = trades.filter((trade) => trade.status === "open");
  const closedTrades = trades.filter((trade) => trade.status === "closed");

  // One quote per distinct symbol, not per position: two open BTC/USD trades
  // are priced by the same verified quote.
  const symbols = [...new Set(openTrades.map((trade) => trade.symbol))];
  const quoteResults = await Promise.all(symbols.map((symbol) => getMarketQuote(symbol)));

  const quotes = new Map<string, { quote: QuoteView | null; error: string | null }>();
  symbols.forEach((symbol, index) => {
    const result = quoteResults[index];
    quotes.set(
      symbol,
      result.ok
        ? { quote: quoteView(result.envelope.data), error: null }
        : { quote: null, error: result.error.message },
    );
  });

  const currentPrices = new Map<string, bigint>();
  for (const [symbol, entry] of quotes) {
    if (!entry.quote) continue;
    const parsed = parseDecimal(entry.quote.price);
    if (parsed !== null) currentPrices.set(symbol, parsed);
  }

  const openPositions = openTrades.map((trade) => {
    const entry = quotes.get(trade.symbol);
    return buildOpenPositionView(trade, entry?.quote ?? null, entry?.error ?? null);
  });
  const closedViews = closedTrades.map(buildClosedTradeView);
  const summary = buildSummary(openTrades, closedTrades, currentPrices);

  const budget = budgetResult.ok ? budgetResult.envelope.data : null;
  const candidates = candidatesResult.ok ? candidatesResult.envelope.data.candidates : [];
  const providers = healthResult.ok ? healthResult.envelope.data : null;

  const equityProvider = providers?.find((provider) => provider.provider === "alpaca") ?? null;
  const cryptoProvider = providers?.find((provider) => provider.provider === "kraken") ?? null;
  const equitiesAvailable = equityProvider?.configured === true;

  const openCandidateIds = openTrades
    .map((trade) => trade.candidateId)
    .filter((id): id is string => id !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Founder only"
        title="Money"
        description="The setups the engine found, the fills you reported from your own exchange, and the P&L those two prices imply. Nothing here places an order."
      />

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          {budget?.disclosure ??
            "Research only. A candidate is a hypothesis to look at, not a trade instruction, and no result here is a probability of profit."}{" "}
          Every entry and exit in this journal is <span className="text-foreground">reported by you</span>.
          The engine never sees your exchange account, so it cannot confirm a fill.
        </p>
      </div>

      <SectionCard
        title="Position summary"
        description="Open figures use the engine's latest verified quote. Realised figures use only the prices you reported."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Open positions"
            value={summary.openCount}
            footnote={
              summary.openCount === 0
                ? "Nothing open"
                : `${summary.openPricedCount} of ${summary.openCount} priced`
            }
          />
          <Stat
            label="Open cost basis"
            value={`$${summary.openCostBasis}`}
            footnote="Entry price × quantity, before fees"
          />
          <Stat
            label="Unrealised, net of entry fee"
            value={`$${summary.openUnrealizedNet}`}
            tone={summary.openUnrealizedNet.startsWith("-") ? "loss" : "profit"}
            footnote={
              summary.openPricedCount < summary.openCount
                ? `Excludes ${summary.openCount - summary.openPricedCount} position(s) with no quote`
                : "Exit fee not yet paid, so not deducted"
            }
          />
          <Stat
            label="Realised, net of fees"
            value={`$${summary.realizedNet}`}
            tone={summary.positive ? "profit" : "loss"}
            footnote={
              summary.closedCount === 0
                ? "No closed trades"
                : `${summary.wins}W / ${summary.losses}L across ${summary.closedCount} closed`
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Market data"
        description="Which venues the engine can actually price. A symbol it cannot price is reported as unavailable, never estimated."
      >
        <ul className="flex flex-col gap-2">
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="font-mono text-foreground">Kraken</span>
            <span className="text-muted-foreground">crypto pairs</span>
            <span
              className={
                cryptoProvider?.configured
                  ? "text-profit"
                  : "text-warning"
              }
            >
              {cryptoProvider?.configured ? "configured" : "not configured"}
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="font-mono text-foreground">Alpaca</span>
            <span className="text-muted-foreground">equities</span>
            <span className={equitiesAvailable ? "text-profit" : "text-warning"}>
              {equitiesAvailable ? "configured" : "not configured"}
            </span>
          </li>
        </ul>
        {!equitiesAvailable ? (
          <p className="mt-3 text-[12px] leading-relaxed text-pretty text-muted-foreground">
            Stocks are unavailable. No equity market-data credential is configured on the engine, so
            it cannot price a stock and this journal will not show one. Crypto pairs are priced by
            Kraken.
          </p>
        ) : null}
        {providers === null ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            The engine&apos;s provider health could not be read, so availability is unknown rather
            than assumed.
          </p>
        ) : null}
      </SectionCard>

      {journalError ? (
        <SectionCard
          title="The trade journal is not initialised"
          description="The database is missing the table this page writes to, so nothing can be recorded yet."
        >
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="text-[12px] leading-relaxed text-pretty text-foreground">
                Migration <span className="font-mono">0007_money_journal.sql</span> has not been
                applied to this database. Run <span className="font-mono">npm run db:setup</span>{" "}
                against it, then reload this page. No trade can be recorded until then, and this
                page will not pretend otherwise.
              </p>
              <p className="mt-1.5 font-mono text-[11px] break-words text-muted-foreground">
                {journalError}
              </p>
            </div>
          </div>
        </SectionCard>
      ) : (
        <MoneyDesk
          candidates={candidates}
          openPositions={openPositions}
          closedTrades={closedViews}
          openCandidateIds={openCandidateIds}
          candidatesError={candidatesResult.ok ? null : candidatesResult.error.message}
        />
      )}
    </div>
  );
}
