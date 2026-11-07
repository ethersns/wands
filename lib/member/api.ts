import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getMemberSession } from "./session";
import { firstIssue } from "./validation";

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in to continue.");
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
