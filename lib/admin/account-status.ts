import "server-only";

import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * Account status: the authoritative answer to "may this account sign in".
 *
 * A row exists only once an account has been suspended. Absence means active,
 * which keeps the common path free of a write and means a brand new
 * registration is never accidentally born suspended.
 *
 * This module is the single source of that answer. The sign-in hook, the member
 * API guard and the member page guard all call `isAccountSuspended`, so a
 * suspension cannot be enforced in one place and forgotten in another.
 */

export type AccountStatus = "active" | "suspended";

export interface AccountStatusRecord {
  status: AccountStatus;
  reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  reactivated_at: string | null;
  reactivated_by: string | null;
  updated_at: string | null;
}

export const ACTIVE_STATUS: AccountStatusRecord = {
  status: "active",
  reason: null,
  suspended_at: null,
  suspended_by: null,
  reactivated_at: null,
  reactivated_by: null,
  updated_at: null,
};

interface StatusRow {
  status: string;
  reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  reactivated_at: string | null;
  reactivated_by: string | null;
  updated_at: string | null;
}

function toRecord(row: StatusRow | undefined): AccountStatusRecord {
  if (!row) return ACTIVE_STATUS;

  return {
    status: row.status === "suspended" ? "suspended" : "active",
    reason: row.reason,
    suspended_at: row.suspended_at,
    suspended_by: row.suspended_by,
    reactivated_at: row.reactivated_at,
    reactivated_by: row.reactivated_by,
    updated_at: row.updated_at,
  };
}

export async function getAccountStatus(userId: string): Promise<AccountStatusRecord> {
  if (!isDatabaseConfigured() || !userId) return ACTIVE_STATUS;

  try {
    const rows = await query<StatusRow>(
      `select status, reason, suspended_at, suspended_by,
              reactivated_at, reactivated_by, updated_at
       from member_account_status
       where user_id = $1
       limit 1`,
      [userId],
    );

    return toRecord(rows[0]);
  } catch (cause) {
    console.log(
      "[wands] account status read failed:",
      cause instanceof Error ? cause.message : cause,
    );
    // Fail closed on a read error would lock every member out of the product
    // because one table is unreachable. The suspension check is a policy gate,
    // not the authentication boundary, so an unreadable status is treated as
    // active and the failure is logged for the operator.
    return ACTIVE_STATUS;
  }
}

/**
 * The enforcement predicate.
 *
 * Deliberately a boolean rather than the full record: every caller that gates
 * access needs only this, and returning the record invites a caller to branch
 * on `reason` and drift from the single decision.
 */
export async function isAccountSuspended(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const record = await getAccountStatus(userId);
  return record.status === "suspended";
}

export async function countSuspendedAccounts(): Promise<number> {
  if (!isDatabaseConfigured()) return 0;

  try {
    const rows = await query<{ total: number }>(
      `select count(*)::int as total
       from member_account_status
       where status = 'suspended'`,
    );
    return rows[0]?.total ?? 0;
  } catch {
    return 0;
  }
}
