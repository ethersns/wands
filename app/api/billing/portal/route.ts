import { NextResponse } from "next/server";

import { billingBlockedReason, billingEnabled, stripeSecretKey } from "@/lib/billing/config";
import { isDatabaseConfigured, query } from "@/lib/db";
import { siteUrl } from "@/lib/marketing/site";
import { getMemberSession } from "@/lib/member/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens the Stripe customer portal.
 *
 * The customer id is read from the signed-in member's own membership row and
 * from nowhere else. It is never accepted from the request, so one member
 * cannot open another member's billing portal by guessing or editing a value —
 * the only customer a caller can reach is the one already attached to their
 * session.
 */
export async function POST() {
  if (!billingEnabled) {
    return NextResponse.json(
      { error: billingBlockedReason ?? "Billing is not open yet.", code: "billing_closed" },
      { status: 503 },
    );
  }

  if (!stripeSecretKey || !isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured.", code: "unavailable" },
      { status: 503 },
    );
  }

  const session = await getMemberSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401 },
    );
  }

  const rows = await query<{ stripe_customer_id: string | null }>(
    `select stripe_customer_id from member_membership where user_id = $1`,
    [session.user.id],
  );

  const customerId = rows[0]?.stripe_customer_id ?? null;

  if (!customerId) {
    return NextResponse.json(
      {
        error: "There is no billing account on this membership yet.",
        code: "no_customer",
      },
      { status: 400 },
    );
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/app/membership`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (cause) {
    console.log(
      "[wands] billing portal failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return NextResponse.json(
      {
        error: "The billing portal could not be opened. Try again in a moment.",
        code: "stripe_error",
      },
      { status: 502 },
    );
  }
}
