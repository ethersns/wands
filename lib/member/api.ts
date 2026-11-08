import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAccountSuspended } from "@/lib/admin/account-status";
import { getMemberSession } from "./session";
import { firstIssue } from "./validation";

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in to continue.");
  }
}

/**
 * A suspended account is authenticated but not authorised.
 *
 * Kept distinct from `UnauthorizedError` so the response is 403 rather than
 * 401: the member's session is real, and telling them to sign in again would
 * send them into a loop the sign-in hook will refuse.
 */
export class SuspendedError extends Error {
  constructor() {
    super("This account is suspended. Contact support if you believe this is a mistake.");
  }
}

export class MemberError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type MemberActor = { userId: string; email: string; name: string };

export async function requireMemberApi(): Promise<MemberActor> {
  const session = await getMemberSession();
  if (!session) throw new UnauthorizedError();

  // Every member endpoint funnels through here, so a suspension blocks the
  // research, watchlist, saved-item and notification APIs in one place rather
  // than in each route. A session that survived the suspension — because it was
  // issued before the operator acted — is refused here.
  if (await isAccountSuspended(session.user.id)) throw new SuspendedError();

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

export async function handleMemberRoute(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SuspendedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: firstIssue(error) }, { status: 400 });
    }
    if (error instanceof MemberError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[wands] member route failed", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
