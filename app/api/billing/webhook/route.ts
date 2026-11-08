import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { dispatchActivation } from "@/lib/billing/activation-dispatch";
import { stripeSecretKey, stripeWebhookSecret } from "@/lib/billing/config";
import {
  markIntentAwaitingPayment,
  markIntentFailed,
  markIntentPaid,
} from "@/lib/billing/signup-intent";
import {
  idOf,
  mapSubscription,
  syncMembershipFromCustomer,
  syncSubscriptionFromStripe,
  upsertBillingCustomer,
  upsertSubscription,
} from "@/lib/billing/subscription-sync";
import { isDatabaseConfigured, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook.
 *
 * This is the only place a payment becomes an entitlement. The success URL is
 * not evidence of anything — a customer can open it, bookmark it or type it —
 * so nothing here trusts the browser. The signature is verified first, and only
 * then is the event's own record of what Stripe charged acted on.
 *
 * Three properties are load-bearing:
 *
 *   * **Signature.** An unsigned or mis-signed body is rejected before it is
 *     parsed, so a forged event cannot grant access.
 *   * **Idempotence.** The event id is the ledger key. A delivery that has
 *     already been processed is acknowledged and skipped, so a Stripe retry
 *     cannot send a second activation email or create a second subscription.
 *   * **Ordering.** Stripe does not promise delivery order. Subscription writes
 *     are guarded by `last_event_at`, and the events that carry only an id are
 *     resolved by reading the live subscription from Stripe.
 */

interface InvoiceLike {
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null;
  } | null;
}

/**
 * Records the delivery and reports whether it still needs handling.
 *
 * A row that exists with `processed_at` set is a replay. A row that exists
 * without it is a delivery that was recorded but failed part-way, and it is
 * retried — the writes it would repeat are all idempotent.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const rows = await query<{ processed_at: Date | null }>(
    `insert into billing_event (id, type, payload)
     values ($1, $2, $3::jsonb)
     on conflict (id) do update set type = excluded.type
     returning processed_at`,
    [event.id, event.type, JSON.stringify(event)],
  );

  return rows[0]?.processed_at === null;
}

async function markEventProcessed(id: string): Promise<void> {
  await query(`update billing_event set processed_at = now() where id = $1`, [id]);
}

async function handleCheckoutPaid(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const intentId = session.metadata?.intent_id ?? session.client_reference_id ?? null;
  if (!intentId) return;

  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  const email = session.customer_details?.email ?? session.customer_email ?? null;

  if (email && customerId) {
    await upsertBillingCustomer(email, customerId);
  }

  await markIntentPaid({ intentId, customerId, subscriptionId });

  // The session carries a subscription id but not its state, so the state is
  // read from Stripe. A failure throws and the delivery is retried.
  if (subscriptionId) {
    await syncSubscriptionFromStripe(subscriptionId);
  }

  await dispatchActivation(intentId);
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required"
      ) {
        await handleCheckoutPaid(session);
        return;
      }

      // A delayed payment method: the session is complete but the money has not
      // settled. Nothing is activated until `async_payment_succeeded`.
      const intentId =
        session.metadata?.intent_id ?? session.client_reference_id ?? null;
      if (intentId) {
        await markIntentAwaitingPayment({
          intentId,
          customerId: idOf(session.customer),
          subscriptionId: idOf(session.subscription),
        });
      }
      return;
    }

    case "checkout.session.async_payment_succeeded": {
      await handleCheckoutPaid(event.data.object as Stripe.Checkout.Session);
      return;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const intentId =
        session.metadata?.intent_id ?? session.client_reference_id ?? null;
      if (intentId) await markIntentFailed(intentId);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const state = mapSubscription(
        event.data.object as Stripe.Subscription,
        event.created,
      );
      if (!state) return;

      await upsertSubscription(state);
      await syncMembershipFromCustomer(state.customerId);
      return;
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as unknown as InvoiceLike;
      const subscriptionId =
        idOf(invoice.subscription) ??
        idOf(invoice.parent?.subscription_details?.subscription);

      // An invoice for a one-off charge has no subscription and no bearing on
      // membership, so it is acknowledged and ignored.
      if (!subscriptionId) return;

      await syncSubscriptionFromStripe(subscriptionId);
      return;
    }

    default:
      return;
  }
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
    const needsHandling = await claimEvent(event);
    if (!needsHandling) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    await handleEvent(event);
    await markEventProcessed(event.id);

    return NextResponse.json({ received: true });
  } catch (cause) {
    console.log(
      "[v0] webhook handling failed:",
      cause instanceof Error ? cause.message : cause,
    );

    // A 500 tells Stripe to retry. The event row is left unprocessed so the
    // retry is handled rather than skipped as a duplicate.
    return NextResponse.json(
      { error: "Webhook could not be processed." },
      { status: 500 },
    );
  }
}
