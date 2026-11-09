import "server-only";

import { todayInReportingZone } from "@/lib/admin/period";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * The security trail.
 *
 * `member_login_event` answers "how many people signed in, and when did this
 * account last sign in". This table answers "what happened to this account that
 * an operator needs to know about" — a failed sign-in, a revoked session, a
 * suspension. Keeping them apart means adding failures here cannot inflate the
 * sign-in counts the analytics pages already report.
 *
 * Every write is best-effort and never throws. A failure to record a security
 * event must not fail the sign-in, the suspension or the deletion it describes;
 * the gap is logged instead.
 */

export type SecurityEventKind =
  | "sign_in_failed"
  | "session_revoked"
  | "account_suspended"
  | "account_reactivated"
  | "account_deleted";

export type SecurityOutcome = "success" | "failure";

/**
 * Security events carry an IP address, which is personal data. 180 days is long
 * enough to investigate a pattern of abuse and short enough that the table does
 * not become a permanent location history.
 */
export const SECURITY_EVENT_RETENTION_DAYS = 180;

export interface SecurityEventInput {
  kind: SecurityEventKind;
  outcome?: SecurityOutcome;
  userId?: string | null;
  emailHash?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await query(
      `insert into member_security_event
         (day, kind, outcome, user_id, email_hash, ip_address, user_agent, detail)
       values ($1::date, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        todayInReportingZone(),
        input.kind,
        input.outcome ?? "success",
        input.userId ?? null,
        input.emailHash ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.detail ?? {}),
      ],
    );
  } catch (cause) {
    console.log(
      "[wands] security event write failed:",
      cause instanceof Error ? cause.message : cause,
    );
  }
}

export async function pruneOldSecurityEvents(): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await query(
      `delete from member_security_event where day < (current_date - $1::int)`,
      [SECURITY_EVENT_RETENTION_DAYS],
    );
  } catch {
    // Retention is best-effort.
  }
}
