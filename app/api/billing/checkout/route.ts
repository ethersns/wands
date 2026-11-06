import { NextResponse } from "next/server";

import {
  billingEnabled,
  priceIdFor,
  stripeSecretKey,
} from "@/lib/billing/config";
import { siteUrl } from "@/lib/marketing/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BILLING_CLOSED =
  "Billing is not open yet. Join the waitlist and we will email you before any plan is charged.";

function wantsJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes(
    "application/json",
  );
}

async function readPlan(request: Request): Promise<string> {
  if (wantsJson(request)) {
    const body = (await request.json().catch(() => null)) as {
      plan?: unknown;
    } | null;

    return typeof body?.plan === "string" ? body.plan : "";
  }

  const form = await request.formData().catch(() => null);
  const plan = form?.get("plan");

  return typeof plan === "string" ? plan : "";
}

function refuse(request: Request, message: string, status: number) {
  if (wantsJson(request)) {
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.redirect(
    new URL("/pricing?checkout=unavailable", request.url),
    303,
  );
}

export async function POST(request: Request) {
  if (!billingEnabled) {
    return refuse(request, BILLING_CLOSED, 503);
  }

  const plan = await readPlan(request);
  const priceId = priceIdFor(plan);

  if (!priceId || !stripeSecretKey) {
    return refuse(
      request,
      "That plan is not available for checkout yet.",
      400,
    );
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/pricing?checkout=success`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
      metadata: { plan },
    });

    if (!session.url) {
      return refuse(request, "Stripe did not return a checkout link.", 502);
    }

    if (wantsJson(request)) {
      return NextResponse.json({ url: session.url });
    }

    return NextResponse.redirect(session.url, 303);
  } catch (cause) {
    console.log(
      "[v0] checkout session failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return refuse(
      request,
      "Checkout could not be started. Please try again in a moment.",
      502,
    );
  }
}
