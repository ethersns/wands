import { NextResponse } from "next/server";

import {
  billingBlockedReason,
  billingEnabled,
  isMemberPlanId,
  priceIdFor,
  stripeSecretKey,
  type MemberPlanId,
} from "@/lib/billing/config";
import { getEntitlement } from "@/lib/billing/entitlement";
import {
  attachCheckoutSession,
  createSignupIntent,
  isIntentExpired,
  latestIntentForEmail,
  markIntentExpired,
  normalizeEmail,
} from "@/lib/billing/signup-intent";
import { isDatabaseConfigured, query } from "@/lib/db";
import { siteUrl } from "@/lib/marketing/site";
import { getMemberSession } from "@/lib/member/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts a paid signup.
 *
 * The browser sends an email address, a plan *name* and a terms acceptance.
 * Everything that decides what is charged — the price id, the amount, the
 * currency, the interval — is resolved here from server configuration, so a
 * crafted request cannot buy a cheaper plan or a different product.
 *
 * The order of the checks matters. An existing member with a live entitlement
 * is refused before anything is created, so a second subscription cannot be
 * started for an address that already pays. A checkout that is still open is
 * reused rather than duplicated, which makes a double-click idempotent.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ParsedBody =
  | { ok: true; email: string; plan: MemberPlanId }
  | { ok: false; error: string };

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Send an email address and a plan." };
  }

  const record = body as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const plan = typeof record.plan === "string" ? record.plan.trim() : "";

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a valid email address." };
  }

  if (!isMemberPlanId(plan)) {
    return { ok: false, error: "Choose a plan to continue." };
  }

  if (record.termsAccepted !== true) {
    return { ok: false, error: "Accept the subscription terms to continue." };
  }

  return { ok: true, email, plan };
}

function refuse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Reuses a checkout that is still open.
 *
 * Stripe sessions stay open for 24 hours. Returning the existing URL instead of
 * creating a second session is what stops a retried form submission from
 * leaving two payable checkouts behind for the same address.
 */
async function reuseOpenSession(sessionId: string | null): Promise<string | null> {
  if (!sessionId || !stripeSecretKey) return null;

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return session.status === "open" && session.url ? session.url : null;
  } catch (cause) {
    console.log(
      "[v0] checkout session lookup failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

export async function POST(request: Request) {
  if (!billingEnabled) {
    return refuse(
      billingBlockedReason ?? "Billing is not open yet.",
      "billing_closed",
      503,
    );
  }

  if (!isDatabaseConfigured()) {
    return refuse("Signup is temporarily unavailable.", "unavailable", 503);
  }

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed.ok) return refuse(parsed.error, "invalid_request", 400);

  const priceId = priceIdFor(parsed.plan);
  if (!priceId || !stripeSecretKey) {
    return refuse(
      "That plan is not available for checkout yet.",
      "plan_unavailable",
      400,
    );
  }

  // A signed-in member upgrades their own account. The address comes from the
  // session, not the body, so a member cannot start a checkout for an address
  // that is not theirs.
  const session = await getMemberSession();
  const email = normalizeEmail(session?.user.email ?? parsed.email);

  try {
    // An address that already pays must not be sold a second subscription.
    const existing = await query<{ id: string }>(
      `select id from "user" where lower(email) = $1 limit 1`,
      [email],
    );

    if (existing[0]) {
      const entitlement = await getEntitlement(existing[0].id);
      if (entitlement.allowed) {
        return refuse(
          "This email already has an active membership. Sign in to manage it.",
          "already_member",
          409,
        );
      }
    }

    const previous = await latestIntentForEmail(email);

    if (previous?.status === "activated") {
      return refuse(
        "This email already has a paid membership. Sign in to continue.",
        "already_member",
        409,
      );
    }

    if (previous?.status === "paid") {
      return refuse(
        "Payment for this email is already confirmed. Check your inbox for the activation link.",
        "awaiting_activation",
        409,
      );
    }

    if (previous?.status === "pending") {
      if (!isIntentExpired(previous)) {
        const open = await reuseOpenSession(previous.checkoutSessionId);
        if (open) return NextResponse.json({ url: open });
      }
      await markIntentExpired(previous.id);
    }

    const intent = await createSignupIntent({
      email,
      plan: parsed.plan,
      priceId,
    });

    if (!intent) {
      return refuse("Signup could not be started.", "unavailable", 503);
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: intent.id,
      allow_promotion_codes: true,
      metadata: { intent_id: intent.id, plan: parsed.plan },
      subscription_data: {
        metadata: { intent_id: intent.id, plan: parsed.plan },
      },
      success_url: `${siteUrl}/signup/confirmed?intent=${intent.id}`,
      cancel_url: `${siteUrl}/signup?checkout=cancelled&intent=${intent.id}`,
    });

    if (!session.url) {
      return refuse("Stripe did not return a checkout link.", "stripe_error", 502);
    }

    await attachCheckoutSession(intent.id, session.id);

    return NextResponse.json({ url: session.url });
  } catch (cause) {
    console.log(
      "[v0] checkout session failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return refuse(
      "Checkout could not be started. Please try again in a moment.",
      "stripe_error",
      502,
    );
  }
}
