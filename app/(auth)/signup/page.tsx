import type { Metadata } from "next";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";

import { PaidSignupForm } from "@/components/member/paid-signup-form";
import {
  MEMBER_PLANS,
  billingBlockedReason,
  checkoutAvailableFor,
  formatMembershipPrice,
  getMembershipPrice,
} from "@/lib/billing/config";
import { getMemberSession } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Get access",
  description:
    "Start a Wands membership. Insider intelligence, institutional research and the tools to look deeper into market activity.",
  robots: { index: false, follow: false },
};

const included = [
  "Insider Radar with full signal history",
  "Institutional Radar and 13F position changes",
  "Strategy Lab with out-of-sample validation",
  "Saved research, watchlists and notes",
  "Cancel from your billing page at any time",
];

/**
 * Paid signup.
 *
 * This page replaces the previous free registration form. It collects an email
 * address and a terms acceptance and nothing else: no password, no account, no
 * session. The account is created after Stripe confirms the payment and the
 * customer proves they control the address, which is the only ordering that
 * makes "no free accounts" true rather than merely stated.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await getMemberSession();
  if (session) redirect("/app");

  const params = await searchParams;
  const price = await getMembershipPrice("founding");
  const plan = MEMBER_PLANS.founding;

  return (
    <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
      <div>
        <p className="font-marketing-mono text-[11px] uppercase tracking-[0.18em] text-mk-accent">
          Membership
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.03em] text-mk-fg text-balance sm:text-4xl sm:leading-[1.08]">
          Your Wands research workspace starts here.
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-mk-muted text-pretty">
          Get access to insider intelligence, institutional research and the tools
          to look deeper into market activity.
        </p>

        <ul className="mt-7 flex flex-col gap-3 border-t border-mk-line pt-6">
          {included.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-3.5 shrink-0 text-mk-accent" aria-hidden />
              <span className="text-[13px] leading-relaxed text-mk-muted">{item}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
          Research, not advice · No free tier
        </p>
      </div>

      <div className="rounded-2xl border border-mk-line bg-mk-surface/70 p-6 sm:p-8">
        <PaidSignupForm
          planName={plan.name}
          priceLabel={formatMembershipPrice(price)}
          priceConfirmed={price.confirmed}
          checkoutAvailable={checkoutAvailableFor("founding")}
          blockedReason={billingBlockedReason}
          cancelled={params.checkout === "cancelled"}
        />
      </div>
    </div>
  );
}
