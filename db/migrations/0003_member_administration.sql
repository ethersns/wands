-- Member administration: account status, and a security trail.
--
-- Additive only. Nothing here alters or drops an existing column, so the member
-- workspace, the trading console and the waitlist keep working untouched.
--
-- Two concerns are separated deliberately:
--   * member_account_status — the authoritative suspension record. A badge in
--                             the UI is not a suspension; this row is.
--   * member_security_event — failed sign-ins, session revocations and account
--                             status changes. `member_login_event` stays the
--                             successful sign-in history that the analytics
--                             pages already count, so adding failures here
--                             cannot inflate those numbers.

-- ---------------------------------------------------------------------------
-- Account status
-- ---------------------------------------------------------------------------
-- One row per account that has ever been suspended. An account with no row is
-- active, which keeps the common case free of a write and means a brand new
-- registration is never accidentally born suspended.
--
-- `suspended_by` is the operator identity label, never a credential. The row
-- cascades with the account: deleting a member removes their suspension state,
-- and the audit log keeps the durable record of what happened.
create table if not exists member_account_status (
  user_id text primary key references "user"(id) on delete cascade,
  status text not null default 'active',
  reason text,
  suspended_at timestamptz,
  suspended_by text,
  reactivated_at timestamptz,
  reactivated_by text,
  updated_at timestamptz not null default now(),
  constraint member_account_status_status_check check (status in ('active', 'suspended'))
);

create index if not exists member_account_status_status_idx
  on member_account_status (status, updated_at desc);

-- ---------------------------------------------------------------------------
-- Sign-in history gains the minimum metadata needed to investigate an account
-- ---------------------------------------------------------------------------
-- Better Auth already stores `ipAddress` and `userAgent` on the `session` row,
-- but that row is deleted on sign-out, so it cannot answer "where did this
-- account sign in from last month". These columns carry the same two values
-- onto the durable history.
--
-- Both are nullable on purpose: every row written before this migration has no
-- IP, and the UI must say "Not recorded" rather than invent one.
alter table member_login_event add column if not exists ip_address text;
alter table member_login_event add column if not exists user_agent text;

-- Deleting a member must not delete the fact that sign-ins happened, but it
-- must sever the link to the person. The row is kept and `user_id` is set to
-- null, so the aggregate counts stay honest while the account reference is
-- gone. That requires the column to accept null.
alter table member_login_event alter column user_id drop not null;

-- ---------------------------------------------------------------------------
-- Security events
-- ---------------------------------------------------------------------------
-- `user_id` is nullable because a failed sign-in against an unknown address
-- resolves to no account. `email_hash` is a salted digest of the attempted
-- address, so repeated attempts against one address can be correlated without
-- storing the address itself in a table that is read for security review.
--
-- `detail` holds only non-sensitive context: a reason, a session count, an
-- outcome. Never a password, a token or a full user agent string beyond the
-- truncated value in `user_agent`.
create table if not exists member_security_event (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  day date not null,
  kind text not null,
  outcome text not null default 'success',
  user_id text,
  email_hash text,
  ip_address text,
  user_agent text,
  detail jsonb not null default '{}'::jsonb,
  constraint member_security_event_outcome_check check (outcome in ('success', 'failure'))
);

create index if not exists member_security_event_occurred_idx
  on member_security_event (occurred_at desc);
create index if not exists member_security_event_user_idx
  on member_security_event (user_id, occurred_at desc);
create index if not exists member_security_event_kind_idx
  on member_security_event (kind, occurred_at desc);
create index if not exists member_security_event_email_idx
  on member_security_event (email_hash, occurred_at desc);
