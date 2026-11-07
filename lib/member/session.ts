import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { memberAuth } from "@/lib/auth/member";

export const MEMBER_HOME = "/app";

export async function getMemberSession() {
  return memberAuth.api.getSession({ headers: await headers() });
}

/**
 * Authoritative customer gate. Middleware only performs an optimistic cookie
 * check; every protected page and mutation re-validates here.
 */
export async function requireMember(nextPath: string = MEMBER_HOME) {
  const session = await getMemberSession();

  if (!session) {
    redirect(`/signin?next=${encodeURIComponent(nextPath)}`);
  }

  return session;
}
