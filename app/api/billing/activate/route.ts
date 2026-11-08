import { NextResponse } from "next/server";

import { memberAuth } from "@/lib/auth/member";
import {
  consumeActivationToken,
  validateActivationToken,
} from "@/lib/billing/activation";
import { activateMembershipForUser } from "@/lib/billing/subscription-sync";
import {
  linkIntentToUser,
  markIntentActivated,
} from "@/lib/billing/signup-intent";
import { isDatabaseConfigured, query } from "@/lib/db";
import { getMemberSession } from "@/lib/member/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turns a verified payment into a usable account.
 *
 * The activation token is the credential: it was sent to the address the
 * payment was made with, it is single-use, and it expires. Two paths lead out
 * of it, and they are deliberately different:
 *
 *   * **No account yet.** The token proves control of the address, so the
 *     member chooses a password here and the account is created verified.
 *   * **An account already exists.** The token alone is not enough, because
 *     attaching a membership to someone else's existing account would be a
 *     takeover. The caller must also hold a session for that exact address.
 *
 * Nothing is written until the token has been validated, and the token is
 * burned before the entitlement is granted, so a replayed link cannot grant a
 * second time.
 */

const MIN_PASSWORD = 10;

function refuse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function failureMessage(reason: "invalid" | "used" | "expired" | "unpaid"): string {
  switch (reason) {
    case "used":
      return "This activation link has already been used. Sign in to continue.";
    case "expired":
      return "This activation link has expired. Contact support to have a new one sent.";
    case "unpaid":
      return "Payment for this signup has not been confirmed yet. Your account will unlock once Stripe confirms it.";
    default:
      return "That activation link is not valid.";
  }
}

type CreateResult =
  | { ok: true; userId: string; setCookies: string[] }
  | { ok: false; error: string; code: string; status: number };

async function createAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<CreateResult> {
  try {
    const response = await memberAuth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.name || input.email.split("@")[0],
      },
      asResponse: true,
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      return {
        ok: false,
        error: detail?.message ?? "The account could not be created.",
        code: "signup_failed",
        status: 400,
      };
    }

    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { user?: { id?: string } } | null;

    const userId = payload?.user?.id;
    if (!userId) {
      return {
        ok: false,
        error: "The account could not be created.",
        code: "signup_failed",
        status: 500,
      };
    }

    // The activation token already proved control of this address, so the
    // account is verified on creation. Without this, a configured email
    // provider would send a second, redundant confirmation and the member
    // would be locked out until they clicked it.
    await query(`update "user" set "emailVerified" = true where id = $1`, [userId]);

    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    return { ok: true, userId, setCookies };
  } catch (cause) {
    console.log(
      "[v0] activation account creation failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return {
      ok: false,
      error: "The account could not be created.",
      code: "signup_failed",
      status: 500,
    };
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return refuse("Activation is temporarily unavailable.", "unavailable", 503);
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";

  const state = await validateActivationToken(token);
  if (!state.ok) {
    return refuse(
      failureMessage(state.reason),
      state.reason,
      state.reason === "unpaid" ? 409 : 400,
    );
  }

  const { intent } = state.lookup;

  const existing = await query<{ id: string }>(
    `select id from "user" where lower(email) = $1 limit 1`,
    [intent.email],
  );

  let userId: string | null = null;
  let setCookies: string[] = [];

  if (existing[0]) {
    const session = await getMemberSession();

    if (!session || session.user.email.trim().toLowerCase() !== intent.email) {
      return NextResponse.json(
        {
          error:
            "This email already has a Wands account. Sign in to attach the membership to it.",
          code: "sign_in_required",
        },
        { status: 401 },
      );
    }

    userId = session.user.id;
  } else {
    if (password.length < MIN_PASSWORD) {
      return refuse(
        `Use at least ${MIN_PASSWORD} characters for your password.`,
        "weak_password",
        400,
      );
    }

    const created = await createAccount({
      email: intent.email,
      password,
      name,
    });

    if (!created.ok) {
      return refuse(created.error, created.code, created.status);
    }

    userId = created.userId;
    setCookies = created.setCookies;
  }

  if (!userId) {
    return refuse("Activation could not be completed.", "failed", 500);
  }

  const consumed = await consumeActivationToken(token);
  if (!consumed) {
    return refuse(
      "This activation link has already been used. Sign in to continue.",
      "token_used",
      409,
    );
  }

  await linkIntentToUser(intent.id, userId);
  await activateMembershipForUser({
    userId,
    customerId: intent.stripeCustomerId,
    subscriptionId: intent.stripeSubscriptionId,
    plan: intent.plan,
  });
  await markIntentActivated(intent.id);

  const response = NextResponse.json({
    ok: true,
    redirect: setCookies.length > 0 ? "/onboarding" : "/signin?activated=1",
  });

  for (const cookie of setCookies) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}
