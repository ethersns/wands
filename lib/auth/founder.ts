import "server-only";

import { getMemberSession } from "@/lib/member/session";

/**
 * Founder authorization for the Opportunity Desk.
 *
 * Authentication answers who is signed in. This answers whether that account
 * may operate the desk, and it is the only place that answer is produced.
 *
 * The grant is an allowlist of Better Auth user ids held in the server
 * environment. It is read on the server, never sent to the browser, and never
 * derived from a request body, a cookie, or a session field a client could set.
 * It fails closed: an absent, empty or whitespace-only allowlist grants nothing.
 * There is deliberately no "first account to register becomes admin" path, and
 * a paid plan or a completed onboarding does not imply the grant.
 *
 * The engine keeps its own RBAC. This guard decides whether a member may reach
 * the engine's admin surface at all; it does not widen what the engine allows.
 */

const FOUNDER_IDS_ENV = "WANDS_FOUNDER_USER_IDS";

export type FounderDenial = "unauthenticated" | "forbidden" | "unconfigured";

export type FounderAccess =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: FounderDenial };

/** The configured allowlist. Empty when the variable is absent or blank. */
export function founderUserIds(): ReadonlySet<string> {
  const raw = process.env[FOUNDER_IDS_ENV];
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function founderConfigured(): boolean {
  return founderUserIds().size > 0;
}

/**
 * The authorization decision for an already-authenticated user id.
 *
 * Split from the session lookup so the decision can be tested without a
 * request, and so a caller that already holds a verified session does not pay
 * for a second one.
 */
export function isFounderUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return founderUserIds().has(userId);
}

/**
 * The guard used by the desk page and by every desk server action.
 *
 * It returns a result rather than throwing, so a server action can turn a
 * denial into its own outcome type and a page can choose between a redirect and
 * a not-found without the guard deciding presentation.
 */
export async function requireFounder(): Promise<FounderAccess> {
  const session = await getMemberSession();

  if (!session) {
    return { ok: false, reason: "unauthenticated" };
  }

  if (!founderConfigured()) {
    return { ok: false, reason: "unconfigured" };
  }

  if (!isFounderUserId(session.user.id)) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, userId: session.user.id, email: session.user.email };
}
