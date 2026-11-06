import { Check } from "lucide-react";

import { plans } from "@/lib/marketing/pricing";
import { cn } from "@/lib/utils";

import { ButtonLink } from "./button-link";

export function PricingTable({
  checkoutAvailable,
  className,
}: {
  checkoutAvailable: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-3", className)}>
      {plans.map((plan) => {
        const canCheckout = Boolean(plan.priceIdKey) && checkoutAvailable;

        return (
          <div
            key={plan.id}
            className={cn(
              "relative flex flex-col rounded-xl border p-6",
              plan.featured
                ? "border-mk-accent/30 bg-mk-surface"
                : "border-mk-line bg-mk-surface/60",
            )}
          >
            {plan.featured ? (
              <span className="absolute -top-2.5 left-6 rounded-full border border-mk-accent/30 bg-mk-bg px-2 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-accent uppercase">
                Most chosen
              </span>
            ) : null}

            <div className="flex flex-col gap-1">
              <h3 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-mk-fg">
                {plan.name}
              </h3>
              <p className="text-[12.5px] leading-relaxed text-mk-muted">
                {plan.summary}
              </p>
            </div>

            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="font-display text-4xl font-semibold tracking-[-0.04em] text-mk-fg">
                {plan.price}
              </span>
              <span className="font-marketing-mono text-[10.5px] tracking-[0.08em] text-mk-dim uppercase">
                {plan.cadence}
              </span>
            </div>

            <ul className="mt-5 flex flex-1 flex-col gap-2.5 border-t border-mk-line pt-5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 size-3.5 shrink-0 text-mk-accent"
                    aria-hidden
                  />
                  <span className="text-[12.5px] leading-relaxed text-mk-muted">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-6">
              {canCheckout ? (
                <form action="/api/billing/checkout" method="post">
                  <input type="hidden" name="plan" value={plan.id} />
                  <button
                    type="submit"
                    className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-mk-accent text-[13.5px] font-medium text-mk-accent-ink transition-colors hover:bg-mk-accent/90"
                  >
                    Start {plan.name}
                  </button>
                </form>
              ) : (
                <ButtonLink
                  href="/#access"
                  variant={plan.featured ? "primary" : "secondary"}
                  size="md"
                  className="w-full"
                >
                  {plan.id === "observer" ? "Join the waitlist" : "Request access"}
                </ButtonLink>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
