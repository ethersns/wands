import "server-only";

import { headers } from "next/headers";

import { todayInReportingZone } from "@/lib/admin/period";
import { isDatabaseConfigured, query } from "@/lib/db";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/member/request-context";

/**
 * Durable sign-in history.
 *
 * Better Auth deletes a `session` row when the member signs out, so the session
 * table can answer "who is signed in now" but not "how many people signed in
 * last week". This records the second question.
 *
 * The row holds a user id, a date, and — since the security work — the IP
 * address and user agent the sign-in arrived with. Those two are read from
 * headers the hosting edge writes, never from a client-supplied
 * `x-forwarded-for`, and they are pruned after `LOGIN_EVENT_RETENTION_DAYS`.
 * No token, no credential material, no device fingerprint.
 *
 * Recording is best-effort and never throws: a failure to write an analytics
 * row must not fail a sign-in.
 */

export const LOGIN_EVENT_RETENTION_DAYS = 400;

export async function recordSignIn(userId: string): Promise<void> {
  if (!userId || !isDatabaseConfigured()) return;

  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  try {
    const requestHeaders = await headers();
    ipAddress = clientIpFromHeaders(requestHeaders);
    userAgent = userAgentFromHeaders(requestHeaders);
  } catch {
    // Outside a request scope there is no header set to read. The sign-in is
    // still recorded; the address is simply "Not recorded".
  }

  try {
    await query(
      `insert into member_login_event (user_id, day, kind, ip_address, user_agent)
       values ($1, $2::date, 'sign_in', $3, $4)`,
      [userId, todayInReportingZone(), ipAddress, userAgent],
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
