-- Customer workspace schema. Every table is owned by a Better Auth user and is
-- scoped by user_id in the data layer; there is no cross-tenant read path.

create table if not exists member_profile (
  user_id text primary key references "user"(id) on delete cascade,
  display_name text,
  experience text,
  interests text[] not null default '{}',
  onboarding_step text not null default 'welcome',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists member_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_watchlist_user_idx on member_watchlist (user_id, created_at);

create table if not exists member_watchlist_item (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references member_watchlist(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  symbol text not null,
  market_type text not null default 'equity',
  note text,
  created_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);
create index if not exists member_watchlist_item_user_idx on member_watchlist_item (user_id, created_at desc);

create table if not exists member_saved_item (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  kind text not null,
  ref_id text not null,
  symbol text,
  title text not null,
  summary text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);
create index if not exists member_saved_item_user_idx on member_saved_item (user_id, created_at desc);

create table if not exists member_notification_pref (
  user_id text primary key references "user"(id) on delete cascade,
  insider_activity boolean not null default true,
  institutional_filings boolean not null default true,
  asset_signals boolean not null default true,
  product_updates boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists member_notification (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists member_notification_user_idx on member_notification (user_id, created_at desc);

create table if not exists member_membership (
  user_id text primary key references "user"(id) on delete cascade,
  plan text not null default 'early_access',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
