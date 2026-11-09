-- Paid membership: Stripe reconciliation, pending signups and activation.
--
-- Wands has no free tier. A member account only becomes usable once a Stripe
-- subscription has been paid for and confirmed by a signed webhook, so the
-- schema has to hold three things the original workspace schema did not:
--
--   * the Stripe mirror (`billing_customer`, `subscription`, `billing_event`),
--     which the webhook writes and the operator reads. The webhook route
--     already referenced these tables but no migration ever created them, so a
--     fresh environment failed on the first delivery;
--   * a pending signup record (`member_signup_intent`), created before payment
--     and reconciled afterwards. It is deliberately not a user: it grants
--     nothing, holds no password and cannot be signed into;
--   * a single-use activation token (`member_activation_token`), which is the
--     only path from "paid" to "usable account".
--
-- `member_membership` gains the entitlement columns. `entitlement_source` is
-- the authoritative provenance of access: 'stripe' means a verified
-- subscription, 'comp' means an explicit owner grant, 'none' means no access.
-- Existing rows default to 'none', which is the point — an account created
-- before billing existed does not silently keep free research access.

-- ---------------------------------------------------------------------------
-- Stripe mirror
-- ---------------------------------------------------------------------------

-- One Stripe customer per normalized email. The email is the key because it is
-- the only identifier Wands holds before a customer exists.
create table if not exists billing_customer (
  email_normalized text primary key,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The subscription mirror. `last_event_at` is what makes out-of-order webhook
-- delivery safe: an event older than the state already stored is ignored
-- rather than allowed to roll the subscription backwards.
--
-- `unit_amount`, `currency` and `interval` are copied from the Stripe price so
-- the operator's MRR figure is computed from real subscription records instead
-- of a hardcoded number.
create table if not exists subscription (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null,
  price_id text,
  plan text,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  unit_amount integer,
  currency text,
  interval text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_customer_idx
  on subscription (stripe_customer_id);

create index if not exists subscription_status_idx
  on subscription (status, current_period_end);

-- Webhook ledger. The event id is the idempotency key: Stripe retries
-- deliveries, and a replayed event must not create a second activation.
-- `processed_at` is separate from `received_at` so a delivery that was recorded
-- but failed mid-handling is retried rather than silently skipped.
create table if not exists billing_event (
  id text primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists billing_event_received_idx
  on billing_event (received_at desc);

-- ---------------------------------------------------------------------------
-- Pending signup
-- ---------------------------------------------------------------------------

-- A checkout in progress. This row is the reconciliation key between the
-- browser, the Stripe session and the webhook, and it is the only record that
-- exists before payment. It carries no password and no session.
create table if not exists member_signup_intent (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  plan text not null,
  price_id text not null,
  status text not null default 'pending',
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  user_id text references "user"(id) on delete set null,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  paid_at timestamptz,
  activated_at timestamptz,
  constraint member_signup_intent_status_check check (
    status in ('pending', 'paid', 'activated', 'cancelled', 'failed', 'expired')
  )
);

create index if not exists member_signup_intent_email_idx
  on member_signup_intent (email_normalized, created_at desc);

create index if not exists member_signup_intent_status_idx
  on member_signup_intent (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Activation
-- ---------------------------------------------------------------------------

-- Only the hash of the activation token is stored. A leaked database row
-- therefore cannot be turned into a working activation link, exactly as with a
-- password. `used_at` makes the token single-use; `expires_at` makes it
-- time-limited.
create table if not exists member_activation_token (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references member_signup_intent(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists member_activation_token_intent_idx
  on member_activation_token (intent_id);

-- ---------------------------------------------------------------------------
-- Entitlement
-- ---------------------------------------------------------------------------

alter table member_membership
  add column if not exists entitlement_source text not null default 'none',
  add column if not exists price_id text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists activated_at timestamptz;

alter table member_membership
  alter column plan set default 'none';

-- A new account starts with no entitlement. The previous default granted
-- `early_access` on insert, which is precisely the free access this change
-- removes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_membership_entitlement_source_check'
  ) then
    alter table member_membership
      add constraint member_membership_entitlement_source_check
      check (entitlement_source in ('none', 'stripe', 'comp'));
  end if;
end
$$;
