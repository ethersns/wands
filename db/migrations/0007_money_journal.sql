-- Money: the founder's manual trade journal.
--
-- This is deliberately separate from the engine's `opp_paper_tests`. A paper
-- test freezes a *sized* quantity and lets the engine evaluate a price path; it
-- is a hypothetical about a rule. A row here is a trade the founder actually
-- placed on their own exchange and reported by hand. The two must never be
-- summed, averaged or presented as one record, because one is evidence about a
-- rule and the other is a record of a real position.
--
-- Every row is scoped to the member who reported it. There is no shared or
-- global journal: `user_id` is on the row, every read filters by it, and the
-- row is deleted with the account.
--
-- `candidate_id` is the engine's id for the setup that prompted the trade, kept
-- for provenance only. It is nullable because a founder may record a trade the
-- desk never surfaced, and it is not a foreign key because the engine owns its
-- own database and its own retention.
--
-- `reported_at` and `closed_at` are report times, not exchange fill times. The
-- founder reports a trade after placing it, so the two can differ by minutes.
-- Nothing here claims to be the venue's timestamp, and no P&L is derived from
-- them.

create table if not exists member_money_trade (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,

  symbol text not null,
  market_type text not null check (market_type in ('crypto', 'equity')),

  -- Provenance: the setup that prompted this trade, if there was one.
  candidate_id text,
  strategy_key text,
  strategy_version integer,
  plan_reference_price numeric(28, 10),
  plan_target_price numeric(28, 10),
  plan_stop_price numeric(28, 10),
  plan_reason text,

  status text not null default 'open' check (status in ('open', 'closed')),

  -- What the founder actually got, reported by hand. Never inferred from a
  -- quote, a candle or a candidate: a price the founder did not type is a price
  -- this table must not contain.
  entry_price numeric(28, 10) not null check (entry_price > 0),
  entry_quantity numeric(28, 10) not null check (entry_quantity > 0),
  entry_fee numeric(28, 10) not null default 0 check (entry_fee >= 0),
  reported_at timestamptz not null default now(),

  exit_price numeric(28, 10) check (exit_price is null or exit_price > 0),
  exit_fee numeric(28, 10) check (exit_fee is null or exit_fee >= 0),
  closed_at timestamptz,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A closed trade must carry its exit, and an open one must not. Without this
  -- a half-written exit would read as a closed trade with no exit price, and
  -- the P&L would silently become null instead of the row being refused.
  constraint member_money_trade_exit_complete check (
    (status = 'open' and exit_price is null and closed_at is null)
    or (status = 'closed' and exit_price is not null and closed_at is not null)
  )
);

create index if not exists member_money_trade_user_idx
  on member_money_trade (user_id, reported_at desc);

-- One open position per candidate per member. A double submit of "I Entered"
-- would otherwise record the same trade twice and double the reported exposure.
create unique index if not exists member_money_trade_open_candidate_idx
  on member_money_trade (user_id, candidate_id)
  where status = 'open' and candidate_id is not null;
