import "server-only";

import { founderUserIds } from "@/lib/auth/founder";
import { isDatabaseConfigured, withTransaction } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/member/security-events";

import { recordAdminAction, writeAudit } from "./audit";

/**
 * Destructive member administration.
 *
 * Every function here is a server-side operation with a real effect: a
 * suspension deletes the account's sessions, a deletion removes the account.
 * None of them is a badge change, and none of them trusts the caller — the
 * operator identity is passed in by the caller that already validated the
 * signed session, and the target is re-read and locked inside the transaction
 * so a concurrent request cannot act on a stale row.
 *
 * Two invariants hold across all of them:
 *
 *   * An account in the operator allowlist is never a valid target. Deleting or
 *     suspending it would remove the operator's own access, which is the one
 *     mistake that cannot be undone from inside the product.
 *   * A destructive action and its audit row commit together. If the audit
 *     write fails, the action rolls back.
 */

export type ActionFailureCode =
  | "not_configured"
  | "invalid_id"
  | "not_found"
  | "operator_account"
  | "confirmation_mismatch"
  | "live_subscription"
  | "failed";

export type ActionOutcome =
  | { ok: true; changed: boolean; message: string; detail?: Record<string, unknown> }
  | { ok: false; code: ActionFailureCode; message: string };

const MAX_REASON_LENGTH = 500;

/** Better Auth ids are short alphanumeric strings; anything else is a probe. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidMemberId(id: string | null | undefined): boolean {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function cleanReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REASON_LENGTH);
}

function isOperatorAccount(userId: string): boolean {
  return founderUserIds().has(userId);
}

/**
 * Subscription states that mean Stripe is still billing the customer.
 *
 * Deleting the Wands account while one of these is live would leave a paying
 * customer with no way to reach the product and no record of why. The operator
 * is told to cancel in Stripe first, which is a real manual step rather than a
 * silent cascade.
 */
const LIVE_SUBSCRIPTION_STATES = new Set(["active", "trialing", "past_due", "unpaid"]);

interface LockedUser {
  id: string;
  email: string;
}

async function lockUser(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  userId: string,
): Promise<LockedUser | null> {
  const rows = await tx<LockedUser>(
    `select id, email from "user" where id = $1 for update`,
    [userId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Suspend
// ---------------------------------------------------------------------------

export async function suspendMember(input: {
  userId: string;
  reason: string;
  actor: string;
}): Promise<ActionOutcome> {
  if (!isDatabaseConfigured()) {
    return { ok: false, code: "not_configured", message: "No database is configured." };
  }

  if (!isValidMemberId(input.userId)) {
    return { ok: false, code: "invalid_id", message: "That is not a valid account id." };
  }

  if (isOperatorAccount(input.userId)) {
    return {
      ok: false,
      code: "operator_account",
      message: "This account holds operator access and cannot be suspended from here.",
    };
  }

  const reason = cleanReason(input.reason);

  try {
    const result = await withTransaction<ActionOutcome>(async (tx) => {
      const user = await lockUser(tx, input.userId);

      if (!user) {
        return { ok: false, code: "not_found", message: "That account no longer exists." };
      }

      const current = await tx<{ status: string }>(
        `select status from member_account_status where user_id = $1 for update`,
        [input.userId],
      );

      const alreadySuspended = current[0]?.status === "suspended";

      // A repeated request is not an error, but it must not write a second
      // audit row or a second security event. Sessions are still revoked,
      // because a suspension that left a live session behind would be a bug.
      await tx(
        `insert into member_account_status
           (user_id, status, reason, suspended_at, suspended_by, updated_at)
         values ($1, 'suspended', $2, now(), $3, now())
         on conflict (user_id) do update set
           status = 'suspended',
           reason = excluded.reason,
           suspended_at = now(),
           suspended_by = excluded.suspended_by,
           updated_at = now()`,
        [input.userId, reason, input.actor],
      );

      const revoked = await tx<{ id: string }>(
        `delete from session where "userId" = $1 returning id`,
        [input.userId],
      );

      if (!alreadySuspended) {
        await writeAudit(tx, {
          actor: input.actor,
          action: "member.suspend",
          target: input.userId,
          detail: { reason, sessions_revoked: revoked.length },
        });
      }

      return {
        ok: true,
        changed: !alreadySuspended,
        message: alreadySuspended
          ? "This account was already suspended. Active sessions were revoked again."
          : "Account suspended and all active sessions revoked.",
        detail: { sessions_revoked: revoked.length, already_suspended: alreadySuspended },
      };
    });

    if (result.ok && result.changed) {
      await recordSecurityEvent({
        kind: "account_suspended",
        userId: input.userId,
        detail: { reason, sessions_revoked: result.detail?.sessions_revoked ?? 0 },
      });
    }

    return result;
  } catch (cause) {
    console.log(
      "[v0] suspend member failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, code: "failed", message: "The suspension could not be completed." };
  }
}

// ---------------------------------------------------------------------------
// Reactivate
// ---------------------------------------------------------------------------

export async function reactivateMember(input: {
  userId: string;
  reason: string;
  actor: string;
}): Promise<ActionOutcome> {
  if (!isDatabaseConfigured()) {
    return { ok: false, code: "not_configured", message: "No database is configured." };
  }

  if (!isValidMemberId(input.userId)) {
    return { ok: false, code: "invalid_id", message: "That is not a valid account id." };
  }

  const reason = cleanReason(input.reason);

  try {
    const result = await withTransaction<ActionOutcome>(async (tx) => {
      const user = await lockUser(tx, input.userId);

      if (!user) {
        return { ok: false, code: "not_found", message: "That account no longer exists." };
      }

      const current = await tx<{ status: string }>(
        `select status from member_account_status where user_id = $1 for update`,
        [input.userId],
      );

      if (current[0]?.status !== "suspended") {
        return {
          ok: true,
          changed: false,
          message: "This account is already active. Nothing was changed.",
        };
      }

      await tx(
        `update member_account_status
         set status = 'active',
             reactivated_at = now(),
             reactivated_by = $2,
             updated_at = now()
         where user_id = $1`,
        [input.userId, input.actor],
      );

      await writeAudit(tx, {
        actor: input.actor,
        action: "member.reactivate",
        target: input.userId,
        detail: { reason },
      });

      return {
        ok: true,
        changed: true,
        message: "Account reactivated. The member can sign in again.",
        // The address is returned so the caller can name the account in the
        // confirmation it shows after the row has left the suspended list.
        detail: { email: user.email },
      };
    });

    if (result.ok && result.changed) {
      await recordSecurityEvent({
        kind: "account_reactivated",
        userId: input.userId,
        detail: { reason },
      });
    }

    return result;
  } catch (cause) {
    console.log(
      "[v0] reactivate member failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, code: "failed", message: "The reactivation could not be completed." };
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

interface DeletionCounts {
  watchlists: number;
  saved: number;
  notifications: number;
  sessions: number;
}

export async function deleteMember(input: {
  userId: string;
  confirmEmail: string;
  actor: string;
}): Promise<ActionOutcome> {
  if (!isDatabaseConfigured()) {
    return { ok: false, code: "not_configured", message: "No database is configured." };
  }

  if (!isValidMemberId(input.userId)) {
    return { ok: false, code: "invalid_id", message: "That is not a valid account id." };
  }

  if (isOperatorAccount(input.userId)) {
    return {
      ok: false,
      code: "operator_account",
      message: "This account holds operator access and cannot be deleted from here.",
    };
  }

  try {
    const result = await withTransaction<ActionOutcome>(async (tx) => {
      const user = await lockUser(tx, input.userId);

      if (!user) {
        return { ok: false, code: "not_found", message: "That account no longer exists." };
      }

      // Typing the address is the explicit confirmation. It is compared
      // case-insensitively because an operator copying an address should not
      // fail on capitalisation, but it must match exactly otherwise.
      if (user.email.trim().toLowerCase() !== input.confirmEmail.trim().toLowerCase()) {
        return {
          ok: false,
          code: "confirmation_mismatch",
          message: "The confirmation address does not match this account. Nothing was deleted.",
        };
      }

      const membership = await tx<{
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        status: string | null;
        plan: string | null;
        current_period_end: string | null;
      }>(
        `select stripe_customer_id, stripe_subscription_id, status, plan, current_period_end
         from member_membership where user_id = $1`,
        [input.userId],
      );

      const live = membership[0];
      if (
        live?.stripe_subscription_id &&
        live.status &&
        LIVE_SUBSCRIPTION_STATES.has(live.status)
      ) {
        return {
          ok: false,
          code: "live_subscription",
          message:
            "This account has a live Stripe subscription. Cancel it in Stripe first, then delete the account. Billing history is retained either way.",
        };
      }

      const counts = await tx<DeletionCounts>(
        `select
           (select count(*)::int from member_watchlist where user_id = $1) as watchlists,
           (select count(*)::int from member_saved_item where user_id = $1) as saved,
           (select count(*)::int from member_notification where user_id = $1) as notifications,
           (select count(*)::int from session where "userId" = $1) as sessions`,
        [input.userId],
      );

      // The security trail outlives the account, but the person does not. The
      // account reference, the address digest and the network metadata are all
      // identifiers of a human being, and none of them is needed once the
      // account is gone. What remains is the aggregate record — when, what kind
      // of event, and whether it succeeded — which is what the counts and the
      // security review actually use.
      await tx(
        `update member_login_event
         set user_id = null, ip_address = null, user_agent = null
         where user_id = $1`,
        [input.userId],
      );
      await tx(
        `update member_security_event
         set user_id = null, ip_address = null, user_agent = null, email_hash = null
         where user_id = $1`,
        [input.userId],
      );

      // Billing references are a legal record, not an audit note. They are kept
      // in their own table, reachable only from the operator's billing view, so
      // the general audit log never becomes a place where a deleted customer's
      // payment identity accumulates.
      const hasBillingReference = Boolean(
        live?.stripe_customer_id || live?.stripe_subscription_id,
      );

      let billingReferenceId: string | null = null;

      if (hasBillingReference) {
        const retained = await tx<{ id: string }>(
          `insert into member_billing_reference
             (stripe_customer_id, stripe_subscription_id, plan, membership_status,
              current_period_end, deleted_by)
           values ($1, $2, $3, $4, $5, $6)
           returning id::text as id`,
          [
            live?.stripe_customer_id ?? null,
            live?.stripe_subscription_id ?? null,
            live?.plan ?? null,
            live?.status ?? null,
            live?.current_period_end ?? null,
            input.actor,
          ],
        );
        billingReferenceId = retained[0]?.id ?? null;
      }

      // Every member-owned table cascades from "user", so this one statement
      // removes the profile, watchlists, saved research, notifications,
      // preferences, membership and sessions together.
      await tx(`delete from "user" where id = $1`, [input.userId]);

      // The audit row records that a deletion happened and what it removed. It
      // deliberately carries no account id, no address and no Stripe reference:
      // the account no longer exists, so keeping its identifier here would
      // retain a personal identifier for no operational reason. The billing
      // reference id is a random key into the separate table above.
      await writeAudit(tx, {
        actor: input.actor,
        action: "member.delete",
        target: null,
        detail: {
          ...counts[0],
          billing_reference_retained: billingReferenceId !== null,
          billing_reference_id: billingReferenceId,
        },
      });

      return {
        ok: true,
        changed: true,
        message: hasBillingReference
          ? "Account deleted. Billing references were retained separately."
          : "Account deleted. No billing reference was held for this account.",
        detail: { ...counts[0] },
      };
    });

    if (result.ok && result.changed) {
      await recordSecurityEvent({
        kind: "account_deleted",
        userId: null,
        detail: { ...(result.detail ?? {}) },
      });
    }

    return result;
  } catch (cause) {
    console.log(
      "[v0] delete member failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, code: "failed", message: "The account could not be deleted." };
  }
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

/**
 * Removes one waitlist signup.
 *
 * Deliberately scoped to `waitlist_signup` alone. A waitlist contact and a
 * registered account are different records that happen to share an address, so
 * removing the contact must never touch the account.
 */
export async function deleteWaitlistEntry(input: {
  id: string;
  actor: string;
}): Promise<ActionOutcome> {
  if (!isDatabaseConfigured()) {
    return { ok: false, code: "not_configured", message: "No database is configured." };
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.id)) {
    return { ok: false, code: "invalid_id", message: "That is not a valid waitlist id." };
  }

  try {
    const result = await withTransaction<ActionOutcome>(async (tx) => {
      const removed = await tx<{ email: string }>(
        `delete from public.waitlist_signup where id = $1::uuid returning email`,
        [input.id],
      );

      if (removed.length === 0) {
        return {
          ok: false,
          code: "not_found",
          message: "That waitlist entry no longer exists.",
        };
      }

      await writeAudit(tx, {
        actor: input.actor,
        action: "waitlist.delete",
        target: input.id,
        detail: { email_domain: removed[0].email.split("@")[1] ?? null },
      });

      return { ok: true, changed: true, message: "Waitlist entry removed." };
    });

    return result;
  } catch (cause) {
    console.log(
      "[v0] delete waitlist entry failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, code: "failed", message: "The entry could not be removed." };
  }
}

/** Records a member CSV export. Bulk personal data reads are always attributable. */
export async function recordMemberExport(input: {
  actor: string;
  rows: number;
  filters: Record<string, string | null>;
}): Promise<void> {
  await recordAdminAction({
    actor: input.actor,
    action: "member.export",
    target: "public.user",
    detail: { rows: input.rows, filters: input.filters },
  });
}
