import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { stripeSecretKey, stripeWebhookSecret } from "@/lib/billing/config";
import { isDatabaseConfigured, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SubscriptionLike {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  metadata?: Record<string, string> | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      price?: { id?: string } | null;
      current_period_end?: number | null;
    }>;
  };
}

interface CheckoutSessionLike {
  customer?: string | { id: string } | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
}

function customerId(value: string | { id: string } | null | undefined) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

export async function POST(request: Request) {
  if (!stripeSecretKey || !stripeWebhookSecret) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const raw = await request.text();
  let event: Stripe.Event;

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeSecretKey);
    event = stripe.webhooks.constructEvent(raw, signature, stripeWebhookSecret);
  } catch (cause) {
    console.log(
      "[v0] webhook signature rejected:",
      cause instanceof Error ? cause.message : cause,
    );

    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 },
    );
  }

  try {
    // Stripe retries deliveries, so the event id is the idempotency key.
    await query(
      `insert into public.billing_event (id, type, payload)
       values ($1, $2, $3::jsonb)
       on conflict (id) do nothing`,
      [event.id, event.type, JSON.stringify(event)],
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as unknown as CheckoutSessionLike;
      const id = customerId(session.customer);
      const email = session.customer_details?.email ?? session.customer_email;

      if (id && email) {
        await query(
          `insert into public.billing_customer (email_normalized, stripe_customer_id)
           values ($1, $2)
           on conflict (email_normalized) do update
             set stripe_customer_id = excluded.stripe_customer_id,
                 updated_at = now()`,
          [email.trim().toLowerCase(), id],
        );
      }
    }

    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as unknown as SubscriptionLike;
      const id = customerId(subscription.customer);
      const item = subscription.items?.data?.[0];
      const periodEnd =
        item?.current_period_end ?? subscription.current_period_end ?? null;

      if (id) {
        await query(
          `insert into public.subscription
             (stripe_subscription_id, stripe_customer_id, price_id, plan, status, current_period_end)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (stripe_subscription_id) do update
             set price_id = excluded.price_id,
                 plan = excluded.plan,
                 status = excluded.status,
                 current_period_end = excluded.current_period_end,
                 updated_at = now()`,
          [
            subscription.id,
            id,
            item?.price?.id ?? null,
            subscription.metadata?.plan ?? null,
            subscription.status,
            periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          ],
        );
      }
    }
  } catch (cause) {
    console.log(
      "[v0] webhook handling failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return NextResponse.json(
      { error: "Webhook could not be recorded." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
