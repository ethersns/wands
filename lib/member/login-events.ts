import "server-only";

import { todayInReportingZone } from "@/lib/admin/period";
import { isDatabaseConfigured, query } from "@/lib/db";

/**
 * Durable sign-in history.
 *
 * Better Auth deletes a `session` row when the member signs out, so the session
 * table can answer "who is signed in now" but not "how many people signed in
 * last week". This records the second question.
 *
 * The row holds a user id and a date. No IP address, no user agent, no token,
 * no credential material — the minimum needed to count sign-ins and to show a
 * member's last sign-in to an administrator.
 *
 * Recording is best-effort and never throws: a failure to write an analytics
 * row must not fail a sign-in.
 */

export const LOGIN_EVENT_RETENTION_DAYS = 400;

export async function recordSignIn(userId: string): Promise<void> {
  if (!userId || !isDatabaseConfigured()) return;

  try {
    await query(
      `insert into member_login_event (user_id, day, kind) values ($1, $2::date, 'sign_in')`,
      [userId, todayInReportingZone()],
    );
  } catch (cause) {
    console.log(
      "[v0] login event write failed:",
      cause instanceof Error ? cause.message : cause,
    );
  }
}

export async function pruneOldLoginEvents(): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await query(
      `delete from member_login_event where day < (current_date - $1::int)`,
      [LOGIN_EVENT_RETENTION_DAYS],
    );
  } catch {
    // Retention is best-effort.
  }
}
