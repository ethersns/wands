import Link from "next/link";

import { checkoutAvailableFor } from "@/lib/billing/config";

import { ButtonLink } from "./button-link";
import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { WaitlistForm } from "./waitlist-form";

/**
 * The closing call to action on the marketing pages.
 *
 * Wands is a paid membership, so the primary action is a price, not a signup
 * form. The waitlist is kept only as the honest fallback for a deployment where
 * checkout is not open yet — it is never presented as the way in while billing
 * is live.
 */
export function CtaBand({
  source = "landing",
  title = "See the evidence before you see the price.",
  description = "One membership, billed monthly. Payment first, then activation, then the workspace.",
}: {
  source?: string;
  title?: string;
  description?: string;
}) {
  const checkoutAvailable = checkoutAvailableFor("founding");

  return (
    <section id="access" className="scroll-mt-24 border-t border-mk-line">
      <Container>
        <div className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-4">
            <Eyebrow>Membership</Eyebrow>
            <h2 className="font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl">
              {title}
            </h2>
            <p className="max-w-md text-pretty text-[15px] leading-relaxed text-mk-muted">
              {description}
            </p>
          </div>
          <div className="rounded-xl border border-mk-line bg-mk-surface p-5">
            {checkoutAvailable ? (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  Wands Founding Access is billed monthly, with no free tier and no
                  free trial. The exact amount is shown on the pricing page and again
                  at checkout before you pay.
                </p>
                <ButtonLink
                  href="/pricing"
                  variant="primary"
                  size="md"
                  className="w-full"
                >
                  See pricing and get access
                </ButtonLink>
                <p className="text-[11.5px] leading-relaxed text-mk-dim">
                  Already a member?{" "}
                  <Link
                    href="/signin"
                    className="text-mk-accent underline-offset-4 hover:underline"
                  >
                    Sign in
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-mk-muted">
                  Billing is not open yet. Join the list and we will email you the
                  moment seats are available.
                </p>
                <WaitlistForm source={source} />
              </div>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
