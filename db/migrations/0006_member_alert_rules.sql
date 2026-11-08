-- Member alert rules: the member-defined half of the alerts surface.
--
-- `member_notification` and `member_notification_pref` have existed since the
-- first workspace migration, but nothing ever wrote a notification. The
-- `createNotification` helper had no caller, so the unread badge was
-- permanently zero, the notifications page was permanently empty, and the four
-- preference toggles gated nothing. A member had no way to ask to be told about
-- anything in particular.
--
-- A rule is a standing question about one kind of event, optionally narrowed to
-- one symbol and one threshold. `symbol` null means "every symbol the member
-- tracks", which is why the sweep reads the watchlist at evaluation time rather
-- than copying it here: a rule that silently kept watching a symbol the member
-- removed would be a bug the member could not see.
--
-- `member_alert_delivery` is the idempotency ledger. The unique key is
-- (rule_id, event_key), so re-running a sweep after a partial failure, or two
-- sweeps racing, cannot report the same event twice. It is deliberately a
-- separate table from `member_notification`: a member may delete a
-- notification, but the record that the event was already reported has to
-- survive, or the next sweep would resurrect it.

create table if not exists member_alert_rule (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  kind text not null check (kind in ('insider_purchase', 'insider_sale', 'signal')),
  -- null = every symbol the member tracks.
  symbol text,
  -- Insider rules: minimum reported transaction value in USD. null = no floor.
  min_value numeric(20, 2),
  -- Signal rules: minimum research score on the 0-100 scale. null = no floor.
  min_score integer check (min_score is null or (min_score >= 0 and min_score <= 100)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_alert_rule_user_idx on member_alert_rule (user_id, created_at desc);

create table if not exists member_alert_delivery (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references member_alert_rule(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  -- The engine's id for the underlying event, so a re-run is a no-op.
  event_key text not null,
  notification_id uuid references member_notification(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_id, event_key)
);
create index if not exists member_alert_delivery_user_idx on member_alert_delivery (user_id, created_at desc);
