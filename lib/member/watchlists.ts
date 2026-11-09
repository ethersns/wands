import "server-only";

import { query } from "@/lib/db";

export type WatchlistItem = {
  id: string;
  symbol: string;
  marketType: string;
  note: string | null;
  createdAt: string;
};

export type Watchlist = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  items: WatchlistItem[];
};

type WatchlistRow = {
  id: string;
  name: string;
  is_default: boolean;
  created_at: Date;
  items: Array<{ id: string; symbol: string; marketType: string; note: string | null; createdAt: string }>;
};

const LIST_SQL = `
  select w.id,
         w.name,
         w.is_default,
         w.created_at,
         coalesce(
           json_agg(
             json_build_object(
               'id', i.id,
               'symbol', i.symbol,
               'marketType', i.market_type,
               'note', i.note,
               'createdAt', i.created_at
             ) order by i.created_at desc
           ) filter (where i.id is not null),
           '[]'
         ) as items
  from member_watchlist w
  left join member_watchlist_item i on i.watchlist_id = w.id
  where w.user_id = $1
  group by w.id
  order by w.is_default desc, w.created_at asc
`;

function toWatchlist(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      marketType: item.marketType,
      note: item.note,
      createdAt: new Date(item.createdAt).toISOString(),
    })),
  };
}

export async function listWatchlists(userId: string): Promise<Watchlist[]> {
  const rows = await query<WatchlistRow>(LIST_SQL, [userId]);
  return rows.map(toWatchlist);
}

export async function countWatchlists(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from member_watchlist where user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function ensureDefaultWatchlist(userId: string): Promise<Watchlist> {
  await query(
    `insert into member_watchlist (user_id, name, is_default)
     select $1, 'My watchlist', true
     where not exists (select 1 from member_watchlist where user_id = $1)`,
    [userId],
  );

  const rows = await query<WatchlistRow>(LIST_SQL, [userId]);
  const watchlists = rows.map(toWatchlist);
  return watchlists.find((w) => w.isDefault) ?? watchlists[0];
}

export async function createWatchlist(userId: string, name: string): Promise<Watchlist> {
  const rows = await query<{ id: string }>(
    `insert into member_watchlist (user_id, name) values ($1, $2) returning id`,
    [userId, name],
  );

  const created = await query<WatchlistRow>(`${LIST_SQL.replace("where w.user_id = $1", "where w.user_id = $1 and w.id = $2")}`, [
    userId,
    rows[0].id,
  ]);

  return toWatchlist(created[0]);
}

export async function renameWatchlist(userId: string, watchlistId: string, name: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update member_watchlist set name = $3, updated_at = now()
     where id = $2 and user_id = $1 returning id`,
    [userId, watchlistId, name],
  );
  return rows.length > 0;
}

export async function deleteWatchlist(userId: string, watchlistId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from member_watchlist where id = $2 and user_id = $1 and is_default = false returning id`,
    [userId, watchlistId],
  );
  return rows.length > 0;
}

export async function addWatchlistItem(
  userId: string,
  watchlistId: string,
  symbol: string,
  note?: string,
): Promise<WatchlistItem | null> {
  const owned = await query<{ id: string }>(
    `select id from member_watchlist where id = $2 and user_id = $1`,
    [userId, watchlistId],
  );
  if (owned.length === 0) return null;

  const rows = await query<{ id: string; symbol: string; market_type: string; note: string | null; created_at: Date }>(
    `insert into member_watchlist_item (watchlist_id, user_id, symbol, note)
     values ($2, $1, $3, $4)
     on conflict (watchlist_id, symbol) do update set note = coalesce(excluded.note, member_watchlist_item.note)
     returning id, symbol, market_type, note, created_at`,
    [userId, watchlistId, symbol, note ?? null],
  );

  const row = rows[0];
  return {
    id: row.id,
    symbol: row.symbol,
    marketType: row.market_type,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

export async function removeWatchlistItem(userId: string, itemId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from member_watchlist_item where id = $2 and user_id = $1 returning id`,
    [userId, itemId],
  );
  return rows.length > 0;
}

export async function listTrackedSymbols(userId: string): Promise<string[]> {
  const rows = await query<{ symbol: string }>(
    `select distinct symbol from member_watchlist_item where user_id = $1 order by symbol asc`,
    [userId],
  );
  return rows.map((r) => r.symbol);
}

/**
 * The distinct symbols across watchlists that were already read for this member.
 *
 * Same result as `listTrackedSymbols` — distinct, ascending — without a second
 * query, for a caller that needs the watchlists themselves as well.
 */
export function trackedSymbolsFrom(watchlists: Watchlist[]): string[] {
  const symbols = new Set<string>();
  for (const watchlist of watchlists) {
    for (const item of watchlist.items) symbols.add(item.symbol);
  }
  return [...symbols].sort();
}
