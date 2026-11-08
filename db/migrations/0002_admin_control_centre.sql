-- Founder Admin Control Centre.
--
-- Additive only: nothing here alters or drops an existing table, so the member
-- workspace, the trading console and the waitlist keep working untouched.
--
-- Three concerns are separated deliberately:
--   * site_page_view      — first-party, aggregate web traffic.
--   * member_login_event  — durable sign-in history. Better Auth's `session`
--                           rows are deleted on sign-out, so they cannot answer
--                           "how many people signed in last week".
--   * admin_audit_log     — who did what inside the control centre.

-- ---------------------------------------------------------------------------
-- Web traffic
-- ---------------------------------------------------------------------------
-- `visitor_hash` is a salted digest that is recomputed with a new salt every
-- day, so it can count unique visitors within a day but cannot follow a person
-- across days. No IP address, user agent or cookie value is stored.
create table if not exists site_page_view (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  day date not null,
  path text not null,
  referrer_host text,
  referrer_category text not null default 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  visitor_hash text not null,
  is_operator boolean not null default false
);

create index if not exists site_page_view_day_idx on site_page_view (day);
create index if not exists site_page_view_path_day_idx on site_page_view (path, day);
create index if not exists site_page_view_visitor_day_idx on site_page_view (visitor_hash, day);

-- ---------------------------------------------------------------------------
-- Sign-in history
-- ---------------------------------------------------------------------------
-- Minimum viable metadata: which account, and when. No IP, no user agent, no
-- token, no credential material. Rows are pruned by the retention job below.
create table if not exists member_login_event (
  id bigserial primary key,
  user_id text not null,
  occurred_at timestamptz not null default now(),
  day date not null,
  kind text not null default 'sign_in'
);

create index if not exists member_login_event_day_idx on member_login_event (day);
create index if not exists member_login_event_user_idx on member_login_event (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Administrative audit trail
-- ---------------------------------------------------------------------------
-- `actor` is the operator identity label, never a credential. `detail` holds
-- only non-sensitive context such as a filter or a row count.
create table if not exists admin_audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_log_occurred_idx on admin_audit_log (occurred_at desc);
