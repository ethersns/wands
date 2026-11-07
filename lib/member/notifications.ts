import "server-only";

import { query } from "@/lib/db";

export type NotificationPrefs = {
  insiderActivity: boolean;
  institutionalFilings: boolean;
  assetSignals: boolean;
  productUpdates: boolean;
};

export type MemberNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type PrefRow = {
  insider_activity: boolean;
  institutional_filings: boolean;
  asset_signals: boolean;
  product_updates: boolean;
};

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: Date | null;
  created_at: Date;
};

const DEFAULT_PREFS: NotificationPrefs = {
  insiderActivity: true,
  institutionalFilings: true,
  assetSignals: true,
  productUpdates: false,
};

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await query<PrefRow>(
    `select insider_activity, institutional_filings, asset_signals, product_updates
     from member_notification_pref where user_id = $1`,
    [userId],
  );

  const row = rows[0];
  if (!row) return DEFAULT_PREFS;

  return {
    insiderActivity: row.insider_activity,
    institutionalFilings: row.institutional_filings,
    assetSignals: row.asset_signals,
    productUpdates: row.product_updates,
  };
}

export async function updatePrefs(userId: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
  await query(
    `insert into member_notification_pref
       (user_id, insider_activity, institutional_filings, asset_signals, product_updates, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id) do update
       set insider_activity = excluded.insider_activity,
           institutional_filings = excluded.institutional_filings,
           asset_signals = excluded.asset_signals,
           product_updates = excluded.product_updates,
           updated_at = now()`,
    [userId, prefs.insiderActivity, prefs.institutionalFilings, prefs.assetSignals, prefs.productUpdates],
  );

  return prefs;
}

function toNotification(row: NotificationRow): MemberNotification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listNotifications(userId: string, limit = 50): Promise<MemberNotification[]> {
  const rows = await query<NotificationRow>(
    `select id, kind, title, body, href, read_at, created_at
     from member_notification where user_id = $1
     order by created_at desc limit $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(toNotification);
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from member_notification where user_id = $1 and read_at is null`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update member_notification set read_at = now()
     where id = $2 and user_id = $1 and read_at is null returning id`,
    [userId, id],
  );
  return rows.length > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update member_notification set read_at = now()
     where user_id = $1 and read_at is null returning id`,
    [userId],
  );
  return rows.length;
}

export async function createNotification(
  userId: string,
  input: { kind: string; title: string; body?: string; href?: string },
): Promise<MemberNotification> {
  const rows = await query<NotificationRow>(
    `insert into member_notification (user_id, kind, title, body, href)
     values ($1, $2, $3, $4, $5)
     returning id, kind, title, body, href, read_at, created_at`,
    [userId, input.kind, input.title, input.body ?? null, input.href ?? null],
  );
  return toNotification(rows[0]);
}
