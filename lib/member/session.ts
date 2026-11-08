import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountSuspended } from "@/lib/admin/account-status";
import { memberAuth } from "@/lib/auth/member";

export const MEMBER_HOME = "/app";
export const SUSPENDED_PATH = "/suspended";

export async function getMemberSession() {
  return memberAuth.api.getSession({ headers: await headers() });
}

/**
 * Authoritative customer gate. Middleware only performs an optimistic cookie
 * check; every protected page and mutation re-validates here.
 *
 * A suspended account is sent to `/suspended` rather than to the sign-in form.
 * Its session is genuine, so a sign-in redirect would loop: the sign-in hook
 * refuses to issue a new session for a suspended account.
 */
export async function requireMember(nextPath: string = MEMBER_HOME) {
  const session = await getMemberSession();

  if (!session) {
    redirect(`/signin?next=${encodeURIComponent(nextPath)}`);
  }

  if (await isAccountSuspended(session.user.id)) {
    redirect(SUSPENDED_PATH);
  }

  return session;
}
