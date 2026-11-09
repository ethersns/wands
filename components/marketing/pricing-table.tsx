import { Check } from "lucide-react";

import { foundingPlan } from "@/lib/marketing/pricing";
import { cn } from "@/lib/utils";

import { ButtonLink } from "./button-link";

/**
 * The single membership card.
 *
 * The price is passed in rather than written here, because it is read from the
 * configured Stripe Price. When that price cannot be confirmed the card says so
 * instead of showing a number the checkout might not honour.
 */
export function PricingTable({
  priceLabel,
  priceConfirmed,
  checkoutAvailable,
  className,
}: {
  priceLabel: string;
  priceConfirmed: boolean;
  checkoutAvailable: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-[1.15fr_0.85fr]", className)}>
      <div className="relative flex flex-col rounded-xl border border-mk-accent/30 bg-mk-surface p-6 sm:p-7">
        <span className="absolute -top-2.5 left-6 rounded-full border border-mk-accent/30 bg-mk-bg px-2 py-0.5 font-marketing-mono text-[9.5px] tracking-[0.12em] text-mk-accent uppercase">
          Founding membership
        </span>

        <div className="flex flex-col gap-1">
          <h3 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-mk-fg">
            {foundingPlan.name}
          </h3>
          <p className="text-[13px] leading-relaxed text-mk-muted text-pretty">
            {foundingPlan.summary}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-baseline gap-1.5">
          <span
            className={cn(
              "font-display font-semibold tracking-[-0.04em] text-mk-fg",
              priceConfirmed ? "text-4xl" : "text-lg",
            )}
          >
            {priceLabel}
          </span>
          {priceConfirmed ? (
            <span className="font-marketing-mono text-[10.5px] tracking-[0.08em] text-mk-dim uppercase">
              {foundingPlan.cadence}
            </span>
          ) : null}
        </div>

        <p className="mt-2 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
          Billed monthly · No free trial · Cancel any time
        </p>

        <ul className="mt-6 flex flex-1 flex-col gap-2.5 border-t border-mk-line pt-5">
          {foundingPlan.features.map((feature) => (
            <li key={feature.title} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-mk-accent" aria-hidden />
              <span className="text-[12.5px] leading-relaxed text-mk-muted">
                <span className="text-mk-fg">{feature.title}</span> — {feature.detail}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <ButtonLink
            href={checkoutAvailable ? "/signup" : "/#access"}
            variant="primary"
            size="md"
            className="w-full"
          >
            {checkoutAvailable ? "Get access" : "Join the waitlist"}
          </ButtonLink>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-6 rounded-xl border border-mk-line bg-mk-surface/60 p-6 sm:p-7">
        <div>
          <h3 className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
            How billing works
          </h3>
          <ul className="mt-4 flex flex-col gap-3">
            <li className="text-[12.5px] leading-relaxed text-mk-muted">
              <span className="text-mk-fg">Payment first.</span> No account is
              created until Stripe confirms the subscription.
            </li>
            <li className="text-[12.5px] leading-relaxed text-mk-muted">
              <span className="text-mk-fg">Then activation.</span> We email a
              single-use link to the address you paid with.
            </li>
            <li className="text-[12.5px] leading-relaxed text-mk-muted">
              <span className="text-mk-fg">Then the workspace.</span> Set your
              password and the research opens.
            </li>
          </ul>
        </div>

        <p className="border-t border-mk-line pt-4 font-marketing-mono text-[10px] leading-relaxed tracking-[0.08em] text-mk-dim uppercase">
          Card details are handled by Stripe and never stored by Wands
        </p>
      </div>
    </div>
  );
}
