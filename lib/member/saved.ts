import "server-only";

import { query } from "@/lib/db";

export type SavedKind = "signal" | "filing" | "asset" | "insider";

export type SavedItem = {
  id: string;
  kind: SavedKind;
  refId: string;
  symbol: string | null;
  title: string;
  summary: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type SavedRow = {
  id: string;
  kind: SavedKind;
  ref_id: string;
  symbol: string | null;
  title: string;
  summary: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

function toSaved(row: SavedRow): SavedItem {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.ref_id,
    symbol: row.symbol,
    title: row.title,
    summary: row.summary,
    note: row.note,
    payload: row.payload ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = `id, kind, ref_id, symbol, title, summary, note, payload, created_at`;

export async function listSaved(userId: string, kind?: SavedKind): Promise<SavedItem[]> {
  const rows = kind
    ? await query<SavedRow>(
        `select ${SELECT_COLUMNS} from member_saved_item where user_id = $1 and kind = $2 order by created_at desc`,
        [userId, kind],
      )
    : await query<SavedRow>(
        `select ${SELECT_COLUMNS} from member_saved_item where user_id = $1 order by created_at desc`,
        [userId],
      );

  return rows.map(toSaved);
}

export async function countSaved(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from member_saved_item where user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function saveItem(
  userId: string,
  input: {
    kind: SavedKind;
    refId: string;
    symbol?: string;
    title: string;
    summary?: string;
    note?: string;
    payload?: Record<string, unknown>;
  },
): Promise<SavedItem> {
  const rows = await query<SavedRow>(
    `insert into member_saved_item (user_id, kind, ref_id, symbol, title, summary, note, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, kind, ref_id) do update
       set title = excluded.title,
           summary = excluded.summary,
           payload = excluded.payload,
           note = coalesce(excluded.note, member_saved_item.note)
     returning ${SELECT_COLUMNS}`,
    [
      userId,
      input.kind,
      input.refId,
      input.symbol ?? null,
      input.title,
      input.summary ?? null,
      input.note ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );

  return toSaved(rows[0]);
}

export async function updateSavedNote(userId: string, id: string, note: string): Promise<SavedItem | null> {
  const rows = await query<SavedRow>(
    `update member_saved_item set note = $3 where id = $2 and user_id = $1 returning ${SELECT_COLUMNS}`,
    [userId, id, note],
  );
  return rows[0] ? toSaved(rows[0]) : null;
}

export async function deleteSaved(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from member_saved_item where id = $2 and user_id = $1 returning id`,
    [userId, id],
  );
  return rows.length > 0;
}

export async function deleteSavedByRef(userId: string, kind: SavedKind, refId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from member_saved_item where user_id = $1 and kind = $2 and ref_id = $3 returning id`,
    [userId, kind, refId],
  );
  return rows.length > 0;
}

export async function isSaved(userId: string, kind: SavedKind, refId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `select id from member_saved_item where user_id = $1 and kind = $2 and ref_id = $3`,
    [userId, kind, refId],
  );
  return rows.length > 0;
}
