import "server-only";

import { query } from "@/lib/db";
import type { MoneyTrade } from "./types";
import type { MarketType, ParsedEntry, ParsedExit } from "./validation";

/**
 * The founder's manual trade journal.
 *
 * Every statement here is scoped by `user_id`. There is no RLS on this database,
 * so the filter in the SQL is the boundary: a helper that forgot it would let
 * one member read another's positions. That is why the user id is a required
 * first argument on every function rather than an optional filter.
 *
 * Nothing in this module reads a market price. A row records what the founder
 * reported; the current price is fetched separately and never written back.
 */

interface TradeRow {
  id: string;
  symbol: string;
  market_type: MarketType;
  candidate_id: string | null;
  strategy_key: string | null;
  strategy_version: number | null;
  plan_reference_price: string | null;
  plan_target_price: string | null;
  plan_stop_price: string | null;
  plan_reason: string | null;
  status: "open" | "closed";
  entry_price: string;
  entry_quantity: string;
  entry_fee: string;
  reported_at: Date;
  exit_price: string | null;
  exit_fee: string | null;
  closed_at: Date | null;
  note: string | null;
}

const COLUMNS = `
  id, symbol, market_type, candidate_id, strategy_key, strategy_version,
  plan_reference_price, plan_target_price, plan_stop_price, plan_reason,
  status, entry_price, entry_quantity, entry_fee, reported_at,
  exit_price, exit_fee, closed_at, note
`;

function toTrade(row: TradeRow): MoneyTrade {
  return {
    id: row.id,
    symbol: row.symbol,
    marketType: row.market_type,
    candidateId: row.candidate_id,
    strategyKey: row.strategy_key,
    strategyVersion: row.strategy_version,
    planReferencePrice: row.plan_reference_price,
    planTargetPrice: row.plan_target_price,
    planStopPrice: row.plan_stop_price,
    planReason: row.plan_reason,
    status: row.status,
    entryPrice: row.entry_price,
    entryQuantity: row.entry_quantity,
    entryFee: row.entry_fee,
    reportedAt: row.reported_at.toISOString(),
    exitPrice: row.exit_price,
    exitFee: row.exit_fee,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    note: row.note,
  };
}

export async function listTrades(userId: string, limit = 200): Promise<MoneyTrade[]> {
  const rows = await query<TradeRow>(
    `select ${COLUMNS}
       from member_money_trade
      where user_id = $1
      order by reported_at desc
      limit $2`,
    [userId, limit],
  );

  return rows.map(toTrade);
}

export type OpenTradeResult =
  | { ok: true; trade: MoneyTrade }
  | { ok: false; reason: "duplicate" | "failed"; message: string };

export async function openTrade(userId: string, entry: ParsedEntry): Promise<OpenTradeResult> {
  try {
    const rows = await query<TradeRow>(
      `insert into member_money_trade (
         user_id, symbol, market_type, candidate_id, strategy_key, strategy_version,
         plan_reference_price, plan_target_price, plan_stop_price, plan_reason,
         entry_price, entry_quantity, entry_fee, note
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning ${COLUMNS}`,
      [
        userId,
        entry.symbol,
        entry.marketType,
        entry.candidateId,
        entry.plan?.strategyKey ?? null,
        entry.plan?.strategyVersion ?? null,
        entry.plan?.referencePrice ?? null,
        entry.plan?.targetPrice ?? null,
        entry.plan?.stopPrice ?? null,
        entry.plan?.reason ?? null,
        entry.entryPrice,
        entry.quantity,
        entry.fee,
        entry.note,
      ],
    );

    return { ok: true, trade: toTrade(rows[0]) };
  } catch (cause) {
    // 23505 is a unique violation. The only unique index that can fire here is
    // the one-open-position-per-candidate rule, so a double submit is reported
    // as such rather than as a generic failure.
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505") {
      return {
        ok: false,
        reason: "duplicate",
        message: "You already have an open position recorded for this setup.",
      };
    }

    return {
      ok: false,
      reason: "failed",
      message: cause instanceof Error ? cause.message : "The entry could not be recorded.",
    };
  }
}

export type CloseTradeResult =
  | { ok: true; trade: MoneyTrade }
  | { ok: false; reason: "not_found" | "failed"; message: string };

export async function closeTrade(
  userId: string,
  tradeId: string,
  exit: ParsedExit,
): Promise<CloseTradeResult> {
  try {
    const rows = await query<TradeRow>(
      `update member_money_trade
          set status = 'closed',
              exit_price = $3,
              exit_fee = $4,
              closed_at = now(),
              updated_at = now()
        where id = $1
          and user_id = $2
          and status = 'open'
        returning ${COLUMNS}`,
      [tradeId, userId, exit.exitPrice, exit.fee],
    );

    if (rows.length === 0) {
      return {
        ok: false,
        reason: "not_found",
        message: "That position is not open, or it does not belong to you.",
      };
    }

    return { ok: true, trade: toTrade(rows[0]) };
  } catch (cause) {
    return {
      ok: false,
      reason: "failed",
      message: cause instanceof Error ? cause.message : "The exit could not be recorded.",
    };
  }
}
