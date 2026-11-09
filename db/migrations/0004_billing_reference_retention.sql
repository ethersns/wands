-- Retained billing references for deleted accounts.
--
-- Deleting a member removes the account and everything that cascades from it,
-- including `member_membership`, which is where the Stripe customer and
-- subscription ids lived. Those references are a legal and accounting record:
-- a charge, a refund or a tax filing has to stay traceable to the customer it
-- belongs to long after the product account is gone.
--
-- They are kept here rather than in `admin_audit_log` for two reasons:
--
--   * the audit log is read by more people than the billing data it would
--     describe, and a payment identity does not belong in a general activity
--     feed;
--   * the audit log is append-only history, so a reference written there could
--     never be corrected or removed when its retention period ends. A dedicated
--     table can be pruned on its own schedule.
--
-- Nothing here identifies the person by name or address. The row is reachable
-- from the operator's billing view and from Stripe, which is the system of
-- record for the payment itself.
create table if not exists member_billing_reference (
  id uuid primary key default gen_random_uuid(),
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  membership_status text,
  current_period_end timestamptz,
  deleted_at timestamptz not null default now(),
  deleted_by text not null,
  -- A row with no Stripe reference at all would be a record of nothing.
  constraint member_billing_reference_has_reference check (
    stripe_customer_id is not null or stripe_subscription_id is not null
  )
);

create index if not exists member_billing_reference_deleted_idx
  on member_billing_reference (deleted_at desc);

create index if not exists member_billing_reference_customer_idx
  on member_billing_reference (stripe_customer_id)
  where stripe_customer_id is not null;
