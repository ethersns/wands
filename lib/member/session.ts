import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountSuspended } from "@/lib/admin/account-status";
import { memberAuth } from "@/lib/auth/member";
import { ENTITLEMENT_EXEMPT_HEADER } from "@/lib/auth/routes";
import { getEntitlement, type Entitlement } from "@/lib/billing/entitlement";

export const MEMBER_HOME = "/app";
export const SUSPENDED_PATH = "/suspended";
export const MEMBERSHIP_PATH = "/app/membership";

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

/**
 * The paid gate.
 *
 * Access to the research workspace requires two independent things: a valid
 * session, and an eligible paid entitlement. This is where the second one is
 * enforced for pages, and it is the only place — the workspace layout calls it
 * once, so a new page under `/app` is protected by existing rather than by
 * remembering to add a check.
 *
 * The billing surface is exempt. A member whose subscription lapsed has to be
 * able to reach the page that explains why and takes their payment; sending
 * them there in a loop would be a dead end. The middleware classifies the
 * request and passes the answer down, because a layout cannot read the
 * pathname.
 */
export async function requireMemberAccess(
  nextPath: string = MEMBER_HOME,
): Promise<{ session: Awaited<ReturnType<typeof requireMember>>; entitlement: Entitlement }> {
  const session = await requireMember(nextPath);
  const entitlement = await getEntitlement(session.user.id);
  const exempt = (await headers()).get(ENTITLEMENT_EXEMPT_HEADER) === "1";

  if (!exempt && !entitlement.allowed) {
    redirect(`${MEMBERSHIP_PATH}?from=${encodeURIComponent(nextPath)}`);
  }

  return { session, entitlement };
}
