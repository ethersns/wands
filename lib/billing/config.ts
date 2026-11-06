import "server-only";

/**
 * Billing is deliberately off until the product is ready to charge.
 * Nothing in the app may create a live charge while this is false.
 */
export const billingEnabled = process.env.WANDS_BILLING_ENABLED === "true";

export const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? null;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null;

export const priceIds = {
  operator: process.env.STRIPE_PRICE_OPERATOR ?? null,
  desk: process.env.STRIPE_PRICE_DESK ?? null,
} as const;

export type PaidPlan = keyof typeof priceIds;

export function priceIdFor(plan: string): string | null {
  if (plan === "operator" || plan === "desk") return priceIds[plan];
  return null;
}

/** Checkout is only reachable when billing is on, keys exist and a price is mapped. */
export function checkoutAvailableFor(plan: string): boolean {
  return billingEnabled && Boolean(stripeSecretKey) && Boolean(priceIdFor(plan));
}

export const billingStatus = {
  enabled: billingEnabled,
  keysPresent: Boolean(stripeSecretKey),
  webhookConfigured: Boolean(stripeWebhookSecret),
  pricesMapped: Object.values(priceIds).filter(Boolean).length,
};
